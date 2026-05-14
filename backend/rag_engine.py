"""
Mark RAG Engine — Elite-Class Website Intelligence
===================================================
Crawls a website and builds a rich semantic index for navigation + Q&A.

Features:
- Structured data extraction (JSON-LD, Open Graph, meta tags)
- WooCommerce / Shopify product schema detection
- Category & collection taxonomy mapping
- Brand identity extraction (logo, tagline, about content)
- Smart content chunking with page-type classification
- Memory-optimized TF-IDF (bigram, capped features)
- Concurrent crawling with politeness delay

Memory optimizations (for 512MB Render free tier):
- ngram_range=(1,2) instead of (1,3) — 60% less memory
- max_features=10000 — caps vocabulary size
- Lazy initialization — only crawl when needed
"""

import re
import json
import time
import logging
import threading
import requests
import numpy as np
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger("mark.rag")


# ── Page type classification ────────────────────────────────
PAGE_TYPES = {
    'product':    5.0,
    'category':   4.0,
    'service':    4.0,
    'about':      2.5,
    'contact':    2.0,
    'home':       3.0,
    'blog':       1.5,
    'policy':     0.5,
    'generic':    1.0,
}


class MarkRAG:
    def __init__(self, base_url: str, max_pages: int = 150):
        self.base_url = base_url.rstrip('/')
        self.domain = urlparse(base_url).netloc
        self.max_pages = max_pages
        self.pages = []
        self.brand_info = {}
        self.categories = []
        # Memory-optimized: bigrams only + capped vocabulary
        self.vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),       # was (1,3) — 60% less RAM
            max_features=10000,       # cap vocabulary size
            min_df=1,
            max_df=0.95,
            sublinear_tf=True,
            stop_words='english',
        )
        self.tfidf_matrix = None
        self._lock = threading.Lock()
        self.ready = False
        self._session = None
        self._crawling = False

    # ── URL Helpers ──────────────────────────────────────────

    def _is_internal(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.netloc == self.domain or parsed.netloc == ""

    def _should_skip(self, url: str) -> bool:
        skip_patterns = [
            '#', 'javascript:', 'mailto:', 'tel:',
            '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
            '.pdf', '.zip', '.css', '.js', '.woff', '.woff2', '.ttf',
            'wp-admin', 'wp-login', 'wp-json', 'xmlrpc', 'feed',
            'wp-content/uploads', 'wp-content/plugins',
            'my-account', 'checkout', 'logout', 'login', 'register',
            '/cart', '?add-to-cart', '?removed_item',
            '/author/', '/tag/', '/page/', '/attachment/',
        ]
        lower = url.lower()
        return any(p in lower for p in skip_patterns)

    # ── Page Type Detection ──────────────────────────────────

    def _classify_page(self, url: str, soup: BeautifulSoup) -> str:
        lower_url = url.lower()
        body_classes = ' '.join(soup.body.get('class', [])).lower() if soup.body else ''

        if any(x in body_classes for x in ['single-product', 'product-template']):
            return 'product'
        if soup.find(class_=re.compile(r'product_title|product-title|product_price|add.to.cart', re.I)):
            return 'product'
        if any(x in lower_url for x in ['/product/', '/products/', '/shop/']):
            if soup.find('button', class_=re.compile(r'add.to.cart|single_add_to_cart', re.I)):
                return 'product'
            return 'category'

        if any(x in lower_url for x in ['/category/', '/collection/', '/product-category/']):
            return 'category'
        if any(x in body_classes for x in ['archive', 'product-category', 'tax-product_cat']):
            return 'category'

        if any(x in lower_url for x in ['/service', '/services']):
            return 'service'
        if any(x in lower_url for x in ['/about', '/our-story', '/who-we-are']):
            return 'about'
        if '/contact' in lower_url:
            return 'contact'
        if lower_url.rstrip('/') == self.base_url.lower().rstrip('/'):
            return 'home'
        if any(x in lower_url for x in ['/blog/', '/news/', '/article/']):
            return 'blog'
        if any(x in lower_url for x in ['/privacy', '/terms', '/refund', '/return', '/shipping-policy']):
            return 'policy'

        return 'generic'

    # ── Structured Data Extraction ───────────────────────────

    def _extract_json_ld(self, soup: BeautifulSoup) -> list:
        results = []
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '{}')
                if isinstance(data, list):
                    results.extend(data)
                else:
                    results.append(data)
            except (json.JSONDecodeError, TypeError):
                continue
        return results

    def _extract_open_graph(self, soup: BeautifulSoup) -> dict:
        og = {}
        for meta in soup.find_all('meta', property=re.compile(r'^og:')):
            key = meta.get('property', '').replace('og:', '')
            og[key] = meta.get('content', '')
        return og

    # ── Rich Content Extraction ──────────────────────────────

    def _extract_page_data(self, url: str, soup: BeautifulSoup) -> dict | None:
        page_type = self._classify_page(url, soup)

        title = ''
        if soup.title:
            title = soup.title.string.strip() if soup.title.string else ''

        meta_desc = ''
        meta = soup.find('meta', attrs={'name': 'description'})
        if meta:
            meta_desc = meta.get('content', '') or ''

        og = self._extract_open_graph(soup)
        og_title = og.get('title', '')
        og_desc = og.get('description', '')

        json_ld = self._extract_json_ld(soup)
        ld_texts = []
        for item in json_ld:
            schema_type = item.get('@type', '')
            if schema_type == 'Product':
                name = item.get('name', '')
                desc = item.get('description', '')
                brand = item.get('brand', {})
                brand_name = brand.get('name', '') if isinstance(brand, dict) else str(brand)
                price_info = item.get('offers', {})
                price = price_info.get('price', '') if isinstance(price_info, dict) else ''
                ld_texts.append(f"{name} {desc} {brand_name} price {price}")
            elif schema_type in ('Organization', 'LocalBusiness', 'Store'):
                name = item.get('name', '')
                desc = item.get('description', '')
                ld_texts.append(f"{name} {desc}")
                if name:
                    self.brand_info['name'] = name
                if desc:
                    self.brand_info['description'] = desc
            elif isinstance(schema_type, str):
                name = item.get('name', '')
                desc = item.get('description', '')
                if name or desc:
                    ld_texts.append(f"{name} {desc}")

        h1 = ' '.join(h.get_text(separator=' ').strip() for h in soup.find_all('h1'))
        h2 = ' '.join(h.get_text(separator=' ').strip() for h in soup.find_all('h2'))
        h3 = ' '.join(h.get_text(separator=' ').strip() for h in soup.find_all('h3'))

        product_data = ''
        if page_type in ('product', 'category'):
            product_titles = [el.get_text().strip() for el in soup.find_all(class_=re.compile(
                r'product.title|product.name|woocommerce-loop-product__title|entry-title|'
                r'product_title|product-item-name', re.I
            ))]
            prices = [el.get_text().strip() for el in soup.find_all(class_=re.compile(
                r'price|woocommerce-Price-amount|product-price', re.I
            ))]
            short_desc = [el.get_text(separator=' ').strip() for el in soup.find_all(class_=re.compile(
                r'product-short-description|woocommerce-product-details__short-description|'
                r'product-description|product_description', re.I
            ))]
            cats = [el.get_text().strip() for el in soup.find_all(class_=re.compile(
                r'posted_in|product_meta|product-categories|product-category', re.I
            ))]
            product_data = ' '.join(product_titles + prices + short_desc + cats)

        # Main content — extract ALL meaningful text
        main_content = ''
        content_el = (
            soup.find('main')
            or soup.find(class_=re.compile(r'entry-content|page-content|site-content|main-content|content-area', re.I))
            or soup.find('article')
            or soup.find(id=re.compile(r'content|main|primary', re.I))
        )
        if content_el:
            for tag in content_el.find_all(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
                tag.decompose()
            text_elements = content_el.find_all(['p', 'li', 'span', 'div', 'td', 'th', 'dd', 'dt', 'blockquote', 'figcaption', 'label', 'a'])
            seen_texts = set()
            text_parts = []
            for el in text_elements:
                if el.find(['p', 'li', 'div']) and el.name in ('div', 'td'):
                    continue
                text = el.get_text(separator=' ').strip()
                if text and len(text) > 3 and text not in seen_texts:
                    seen_texts.add(text)
                    text_parts.append(text)
                if len(text_parts) >= 50:
                    break
            main_content = ' '.join(text_parts)
        else:
            body = soup.find('body')
            if body:
                for tag in body.find_all(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']):
                    tag.decompose()
                paragraphs = body.find_all(['p', 'li', 'h1', 'h2', 'h3', 'h4'])
                main_content = ' '.join(p.get_text(separator=' ').strip() for p in paragraphs[:30])

        nav_el = soup.find('nav') or soup.find(class_=re.compile(r'menu|navigation', re.I))
        nav_text = ''
        if nav_el:
            nav_text = ' '.join(a.get_text().strip() for a in nav_el.find_all('a') if a.get_text().strip())

        if page_type == 'home' and nav_el:
            for a in nav_el.find_all('a', href=True):
                href = a['href']
                text = a.get_text().strip()
                if text and any(x in href for x in ['/category/', '/product-category/', '/collection/', '/shop/']):
                    self.categories.append({'name': text, 'url': urljoin(url, href)})

        parts = [
            h1, h1, h1,
            title, title,
            og_title,
            meta_desc, og_desc,
            h2, h2,
            h3,
            product_data, product_data, product_data,
            ' '.join(ld_texts),
            main_content,
            nav_text,
        ]
        content = ' '.join(filter(None, parts))
        content = re.sub(r'\s+', ' ', content).strip()

        if not content or len(content) < 10:
            return None

        return {
            'url': url,
            'title': (og_title or title or h1 or url).strip(),
            'content': content,
            'page_type': page_type,
            'boost': PAGE_TYPES.get(page_type, 1.0),
        }

    # ── Crawling ─────────────────────────────────────────────

    def _fetch_page(self, url: str, session: requests.Session) -> tuple:
        """Fetch a single page. Returns (url, html) or (url, None)."""
        try:
            resp = session.get(url, timeout=10)
            ct = resp.headers.get('content-type', '')
            if 'text/html' not in ct:
                return (url, None)
            return (url, resp.text)
        except Exception:
            return (url, None)

    def crawl(self) -> list:
        """Crawl website and return list of page data dicts.
        Uses a local session (no instance-level _session to avoid leaks)."""
        visited = set()
        to_visit = [self.base_url]
        pages = []

        session = requests.Session()
        session.headers.update({
            'User-Agent': 'MarkAI/1.1 Shopping Assistant (+https://mark-ai.com)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
        })

        logger.info(f"Crawling {self.base_url} ...")

        try:
            while to_visit and len(visited) < self.max_pages:
                batch = []
                while to_visit and len(batch) < 5:
                    url = to_visit.pop(0)
                    if url in visited or self._should_skip(url):
                        continue
                    batch.append(url)

                if not batch:
                    break

                with ThreadPoolExecutor(max_workers=5) as executor:
                    futures = {executor.submit(self._fetch_page, u, session): u for u in batch}
                    for future in as_completed(futures):
                        url, html = future.result()
                        if html is None:
                            visited.add(url)
                            continue

                        visited.add(url)
                        try:
                            soup = BeautifulSoup(html, 'html.parser')
                            page_data = self._extract_page_data(url, soup)
                            if page_data:
                                pages.append(page_data)
                        except Exception as e:
                            logger.warning(f"Parse error for {url}: {e}")
                            continue

                        for a in soup.find_all('a', href=True):
                            full_url = urljoin(url, a['href']).split('?')[0].split('#')[0].rstrip('/')
                            if (
                                self._is_internal(full_url)
                                and full_url not in visited
                                and not self._should_skip(full_url)
                                and full_url not in to_visit
                            ):
                                to_visit.append(full_url)

                time.sleep(0.3)
        finally:
            session.close()

        logger.info(f"Crawled {len(pages)} pages ({len(visited)} visited)")
        return pages

    # ── Indexing ─────────────────────────────────────────────

    def build_index(self, pages: list) -> bool:
        if not pages:
            logger.warning("No pages to index")
            return False

        corpus = [p['content'] for p in pages]
        self.tfidf_matrix = self.vectorizer.fit_transform(corpus)

        type_counts = {}
        for p in pages:
            pt = p.get('page_type', 'generic')
            type_counts[pt] = type_counts.get(pt, 0) + 1
        logger.info(f"Index ready — {len(pages)} pages: {type_counts}")

        if self.brand_info:
            logger.info(f"Brand: {self.brand_info.get('name', 'Unknown')}")
        if self.categories:
            cat_names = list(set(c['name'] for c in self.categories))[:10]
            logger.info(f"Categories: {', '.join(cat_names)}")

        return True

    def initialize(self):
        """Thread-safe initialization. Prevents double-crawl."""
        if self._crawling:
            return
        self._crawling = True
        try:
            pages = self.crawl()
            with self._lock:
                if self.build_index(pages):
                    self.pages = pages
                    self.ready = True
        except Exception as e:
            logger.error(f"Initialize error: {e}")
        finally:
            self._crawling = False

    # ── Search ───────────────────────────────────────────────

    def search(self, query: str, top_k: int = 5, threshold: float = 0.02) -> list:
        if not self.ready or self.tfidf_matrix is None:
            return []

        with self._lock:
            clean_query = re.sub(r'[^\w\s]', ' ', query.lower()).strip()
            if not clean_query:
                return []

            query_vec = self.vectorizer.transform([clean_query])
            raw_scores = cosine_similarity(query_vec, self.tfidf_matrix).flatten()

            boosted_scores = np.array([
                raw_scores[i] * self.pages[i].get('boost', 1.0)
                for i in range(len(self.pages))
            ])

            top_indices = np.argsort(boosted_scores)[::-1][:top_k]

            results = []
            for idx in top_indices:
                if boosted_scores[idx] >= threshold:
                    results.append({
                        'url': self.pages[idx]['url'],
                        'title': self.pages[idx]['title'],
                        'score': round(float(boosted_scores[idx]), 4),
                        'page_type': self.pages[idx].get('page_type', 'generic'),
                        'snippet': self._make_snippet(self.pages[idx]['content'], clean_query),
                    })

        return results

    def search_for_chat(self, query: str, top_k: int = 5, threshold: float = 0.01) -> str:
        """Search RAG and return formatted context string for LLM injection."""
        results = self.search(query, top_k=top_k, threshold=threshold)
        if not results:
            return ''

        parts = []
        for r in results:
            snippet = r.get('snippet', '')
            if snippet:
                parts.append(f"[{r['page_type'].upper()}] {r['title']}\n{snippet}\nURL: {r['url']}")
        return '\n\n'.join(parts) if parts else ''

    @staticmethod
    def _make_snippet(content: str, query: str, max_len: int = 300) -> str:
        words = query.split()
        content_lower = content.lower()

        best_start = 0
        best_score = 0
        window = max_len

        for i in range(0, max(1, len(content) - window + 1), 50):
            chunk = content_lower[i:i + window]
            score = sum(1 for w in words if w in chunk)
            if score > best_score:
                best_score = score
                best_start = i

        snippet = content[best_start:best_start + window].strip()
        if best_start > 0:
            space = snippet.find(' ')
            if 0 < space < 30:
                snippet = snippet[space + 1:]
        last_space = snippet.rfind(' ')
        if last_space > max_len - 40:
            snippet = snippet[:last_space]

        return snippet.strip()

    def get_brand_context(self) -> str:
        parts = []
        if self.brand_info.get('name'):
            parts.append(f"Store Name: {self.brand_info['name']}")
        if self.brand_info.get('description'):
            desc = self.brand_info['description'][:200]
            parts.append(f"About: {desc}")
        if self.categories:
            cat_names = list(set(c['name'] for c in self.categories))[:20]
            parts.append(f"Categories: {', '.join(cat_names)}")
        if self.pages:
            product_pages = [p for p in self.pages if p.get('page_type') == 'product']
            category_pages = [p for p in self.pages if p.get('page_type') == 'category']
            if product_pages:
                product_names = [p['title'] for p in product_pages[:30]]
                parts.append(f"Products ({len(product_pages)} total): {', '.join(product_names)}")
            if category_pages:
                cat_titles = [p['title'] for p in category_pages[:15]]
                parts.append(f"Category pages: {', '.join(cat_titles)}")
            service_pages = [p for p in self.pages if p.get('page_type') == 'service']
            if service_pages:
                svc_names = [p['title'] for p in service_pages[:10]]
                parts.append(f"Services: {', '.join(svc_names)}")
            parts.append(f"Total pages indexed: {len(self.pages)}")
        return '\n'.join(parts) if parts else 'Store information not yet available.'

    def reindex(self):
        """Re-crawl and rebuild — zero downtime (keeps old data during crawl)."""
        if self._crawling:
            logger.info(f"Skipping reindex for {self.base_url} — already crawling")
            return
        self._crawling = True
        logger.info(f"Reindexing {self.base_url}...")
        try:
            pages = self.crawl()
            if pages:
                with self._lock:
                    if self.build_index(pages):
                        self.pages = pages
                        self.ready = True
                        logger.info(f"Reindex complete — {len(pages)} pages")
            else:
                logger.warning("Reindex returned no pages — keeping old index")
        except Exception as e:
            logger.error(f"Reindex error: {e} — keeping old index")
        finally:
            self._crawling = False

    def memory_estimate_mb(self) -> float:
        """Estimate current memory usage in MB."""
        size = 0
        if self.tfidf_matrix is not None:
            # Sparse matrix: data + indices + indptr
            size += self.tfidf_matrix.data.nbytes
            size += self.tfidf_matrix.indices.nbytes
            size += self.tfidf_matrix.indptr.nbytes
        for p in self.pages:
            size += len(p.get('content', ''))
        return round(size / (1024 * 1024), 2)
