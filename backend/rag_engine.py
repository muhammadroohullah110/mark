import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import threading


class MarkRAG:
    def __init__(self, base_url: str, max_pages: int = 120):
        self.base_url = base_url.rstrip('/')
        self.domain = urlparse(base_url).netloc
        self.max_pages = max_pages
        self.pages = []
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=1, stop_words=None)
        self.tfidf_matrix = None
        self._lock = threading.Lock()
        self.ready = False

    def _is_internal(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.netloc == self.domain or parsed.netloc == ""

    def _should_skip(self, url: str) -> bool:
        skip_patterns = [
            '#', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
            '.pdf', '.zip', '.css', '.js', '.ico',
            'wp-admin', 'wp-login', 'wp-json', 'xmlrpc', 'feed',
            'wp-content/uploads', 'cart', 'my-account', 'checkout', 'logout'
        ]
        return any(p in url for p in skip_patterns)

    def _extract_page_data(self, url: str, soup: BeautifulSoup) -> dict | None:
        title = soup.title.string.strip() if soup.title else ''

        meta_desc = ''
        meta = soup.find('meta', attrs={'name': 'description'})
        if meta:
            meta_desc = meta.get('content', '')

        headings = ' '.join(h.get_text(separator=' ').strip() for h in soup.find_all(['h1', 'h2', 'h3']))

        # Nav links give great page discovery signals
        nav_texts = ' '.join(a.get_text().strip() for a in soup.find_all('a') if a.get_text().strip())

        # WooCommerce / Shopify product names
        product_names = ' '.join(
            el.get_text().strip()
            for el in soup.find_all(class_=lambda c: c and any(
                kw in c for kw in ['product-title', 'product-name', 'woocommerce-loop-product__title', 'entry-title']
            ))
        )

        content = ' '.join(filter(None, [title, meta_desc, headings, product_names, nav_texts]))

        if not content.strip():
            return None

        return {
            'url': url,
            'title': title or url,
            'content': content
        }

    def crawl(self):
        visited = set()
        to_visit = [self.base_url]
        pages = []
        headers = {'User-Agent': 'MarkAI/1.0 Shopping Assistant'}

        print(f"🕷️  Crawling {self.base_url} ...")

        while to_visit and len(visited) < self.max_pages:
            url = to_visit.pop(0)
            if url in visited or self._should_skip(url):
                continue

            try:
                resp = requests.get(url, headers=headers, timeout=8)
                content_type = resp.headers.get('content-type', '')
                if 'text/html' not in content_type:
                    continue

                visited.add(url)
                soup = BeautifulSoup(resp.text, 'html.parser')
                page_data = self._extract_page_data(url, soup)
                if page_data:
                    pages.append(page_data)

                # Discover internal links
                for a in soup.find_all('a', href=True):
                    full_url = urljoin(url, a['href']).split('?')[0].rstrip('/')
                    if (
                        self._is_internal(full_url)
                        and full_url not in visited
                        and not self._should_skip(full_url)
                    ):
                        to_visit.append(full_url)

            except Exception as e:
                print(f"  Skip {url}: {e}")
                continue

        print(f"✅ Crawled {len(pages)} pages")
        return pages

    def build_index(self, pages: list):
        if not pages:
            print("⚠️  No pages to index")
            return False

        corpus = [p['content'] for p in pages]
        self.tfidf_matrix = self.vectorizer.fit_transform(corpus)
        print(f"✅ Index ready — {len(pages)} pages")
        return True

    def initialize(self):
        with self._lock:
            pages = self.crawl()
            if self.build_index(pages):
                self.pages = pages
                self.ready = True

    def search(self, query: str, top_k: int = 3, threshold: float = 0.03):
        if not self.ready or self.tfidf_matrix is None:
            return []

        with self._lock:
            query_vec = self.vectorizer.transform([query])
            scores = cosine_similarity(query_vec, self.tfidf_matrix).flatten()
            top_indices = np.argsort(scores)[::-1][:top_k]

            results = []
            for idx in top_indices:
                if scores[idx] >= threshold:
                    results.append({
                        'url': self.pages[idx]['url'],
                        'title': self.pages[idx]['title'],
                        'score': round(float(scores[idx]), 4)
                    })

        return results

    def reindex(self):
        """Call this to re-crawl and rebuild the index (e.g. after new products added)."""
        self.ready = False
        threading.Thread(target=self.initialize, daemon=True).start()
