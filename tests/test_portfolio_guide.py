import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://jjmoores23.github.io/portfolio-website/"
KNOWLEDGE_URL = f"{SITE_URL}portfolio-guide-context.html"


class LinkCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])

    def handle_data(self, data):
        self.text.append(data)


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_homepage_uses_dedicated_knowledge_url():
    homepage = read("index.html")

    assert f'data-info-url="{KNOWLEDGE_URL}"' in homepage
    assert 'data-general-knowledge="true"' in homepage
    assert 'href="portfolio-guide-context.html"' in homepage


def test_knowledge_page_covers_quality_questions():
    parser = LinkCollector()
    parser.feed(read("portfolio-guide-context.html"))
    knowledge = re.sub(
        r"\s+",
        " ",
        " ".join(parser.text + parser.links),
    ).casefold()
    cases = json.loads(read("tests/portfolio_guide_cases.json"))

    for case in cases:
        missing = [term for term in case["required_terms"] if term.casefold() not in knowledge]
        assert not missing, f'{case["id"]} is missing knowledge terms: {missing}'


def test_knowledge_page_local_links_resolve():
    parser = LinkCollector()
    parser.feed(read("portfolio-guide-context.html"))

    missing = []
    for href in parser.links:
        parsed = urlparse(href)
        if parsed.scheme or href.startswith("mailto:") or href.startswith("#"):
            continue
        local_path = unquote(parsed.path)
        if not (ROOT / local_path).is_file():
            missing.append(href)

    assert not missing, f"Knowledge page has missing local links: {missing}"


def test_every_essay_exposes_a_javascript_free_plain_text_source():
    essay_pages = sorted(ROOT.glob("essay-*.html"))
    assert len(essay_pages) == 7

    for essay_page in essay_pages:
        html = essay_page.read_text(encoding="utf-8")
        marker = 'rel="alternate" type="text/plain" href="'
        assert marker in html, f"{essay_page.name} has no plain-text alternate"
        href = html.split(marker, 1)[1].split('"', 1)[0]
        assert (ROOT / href).is_file(), f"{essay_page.name} links to missing {href}"
        assert html.count(href) >= 2, f"{essay_page.name} does not visibly link to {href}"


def test_ai_discovery_files_reference_canonical_sources():
    assert KNOWLEDGE_URL in read("llms.txt")
    assert KNOWLEDGE_URL in read("sitemap.xml")
    assert f"{SITE_URL}sitemap.xml" in read("robots.txt")


def test_widget_sends_navigation_context_and_safely_renders_markdown():
    widget = read("widget.js")

    assert "current_page_url: pageContext.url" in widget
    assert "current_page_title: pageContext.title" in widget
    assert "page_context: pageContext" in widget
    assert 'answer_scope: "portfolio_first_general_knowledge"' in widget
    assert "allow_general_knowledge: cfg.allowGeneralKnowledge" in widget
    assert "function safeLink" in widget
    assert 'parsed.protocol !== "http:"' in widget
    assert '.replace(/&/g, "&amp;")' in widget


def test_mobile_chat_input_meets_browser_zoom_threshold():
    widget = read("widget.js")

    assert "@media (max-width: 600px)" in widget
    assert "font-size: 16px" in widget
    assert "line-height: 1.25" in widget


def test_widget_includes_suggestions_accessibility_and_tab_session_persistence():
    widget = read("widget.js")

    assert "SUGGESTED_QUESTIONS" in widget
    assert 'id="suggestions"' in widget
    assert 'role="dialog"' in widget
    assert 'aria-modal="true"' in widget
    assert 'inert' in widget
    assert 'aria-labelledby="chat-title"' in widget
    assert 'aria-busy="false"' in widget
    assert "CONVERSATION_STORAGE_KEY" in widget
    assert "navigationEntry?.type === \"reload\"" in widget
    assert "persistConversation" in widget
    assert "enterkeyhint=\"send\"" in widget
