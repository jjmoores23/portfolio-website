import json
import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright


CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORTFOLIO_URL = "http://127.0.0.1:8000/index.html"
EXTRACTOR_URL = "http://127.0.0.1:8000/tiktok-extractor.html?api=http://127.0.0.1:5055"
TIKTOK_URL = "https://vt.tiktok.com/ZSXhRCN9p/"
SLOPPY_JOE_URL = "https://vt.tiktok.com/ZS434t6W7/"
CREAMY_CHICKEN_PASTA_URL = "https://vt.tiktok.com/ZS43VX9Dd/"
LIVE_GUIDE_URL = os.environ.get(
    "LIVE_GUIDE_URL",
    "https://jjmoores23.github.io/portfolio-website/",
)
GUIDE_CASES_PATH = Path(__file__).with_name("portfolio_guide_cases.json")


@pytest.mark.skipif(
    os.environ.get("RUN_E2E_WIDGET") != "1",
    reason="Set RUN_E2E_WIDGET=1 after starting the static server.",
)
def test_portfolio_guide_widget_is_homepage_only():
    page_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.add_init_script(
            r"""(() => {
                class FakeWebSocket extends EventTarget {
                    static OPEN = 1;

                    constructor(url) {
                        super();
                        this.url = url;
                        this.readyState = 0;
                        window.__guideSocket = this;
                        window.__guidePayloads = [];
                        setTimeout(() => {
                            this.readyState = FakeWebSocket.OPEN;
                            this.dispatchEvent(new Event("open"));
                        }, 0);
                    }

                    send(payload) {
                        window.__guidePayloads.push(JSON.parse(payload));
                        const answer = [
                            "### Projects\n",
                            "**Thirdle** uses `Python`. ",
                            "[Open project](https://example.com/project?q=guide&view=full)\n",
                            "<script>window.__unsafeGuideScript = true</script>"
                        ];
                        answer.forEach((text, index) => {
                            setTimeout(() => {
                                this.dispatchEvent(new MessageEvent("message", {
                                    data: JSON.stringify({ type: "token", text })
                                }));
                            }, index * 5);
                        });
                        setTimeout(() => {
                            this.dispatchEvent(new MessageEvent("message", {
                                data: JSON.stringify({ type: "done" })
                            }));
                        }, answer.length * 5);
                    }

                    close() {
                        this.readyState = 3;
                        this.dispatchEvent(new Event("close"));
                    }
                }

                window.WebSocket = FakeWebSocket;
            })();"""
        )
        page.goto(PORTFOLIO_URL, wait_until="domcontentloaded")
        page.locator("#mcp-widget-host").wait_for(timeout=15_000)

        widget_state = page.evaluate(
            """() => {
                const host = document.querySelector("#mcp-widget-host");
                const shadow = host?.shadowRoot;
                const launcher = shadow?.querySelector(".fab");
                launcher?.click();

                return {
                    disclosure: document.querySelector(".portfolio-guide-note")?.textContent,
                    localScript: [...document.scripts].some(
                        (script) => script.src.endsWith("/widget.js")
                    ),
                    launcherPresent: Boolean(launcher),
                    launcherImage: shadow?.querySelector(".launcher-logo")?.getAttribute("src"),
                    windowOpen: shadow?.querySelector(".window")?.classList.contains("open"),
                    name: shadow?.querySelector(".header-title")?.textContent,
                    expanded: launcher?.getAttribute("aria-expanded"),
                    suggestionCount: shadow?.querySelectorAll(".suggestion-btn").length,
                    dialogRole: shadow?.querySelector(".window")?.getAttribute("role"),
                    dialogLabel: shadow?.querySelector(".window")?.getAttribute("aria-labelledby"),
                };
            }"""
        )
        assert "external AI service" in widget_state["disclosure"]
        assert widget_state["localScript"]
        assert widget_state["launcherPresent"]
        assert widget_state["launcherImage"] == "newlogo.png"
        assert widget_state["windowOpen"]
        assert widget_state["name"] == "Portfolio Guide"
        assert widget_state["expanded"] == "true"
        assert widget_state["suggestionCount"] == 4
        assert widget_state["dialogRole"] == "dialog"
        assert widget_state["dialogLabel"] == "chat-title"
        assert not page_errors

        page.locator("#mcp-widget-host >> .suggestion-btn").first.click()
        page.wait_for_function(
            """() => !document.querySelector("#mcp-widget-host")
                .shadowRoot.querySelector("#send-btn").disabled"""
        )

        response_state = page.evaluate(
            """() => {
                const shadow = document.querySelector("#mcp-widget-host").shadowRoot;
                const botBody = [...shadow.querySelectorAll(".message.bot .message-body")].at(-1);
                const payload = window.__guidePayloads.at(-1);
                return {
                    boldText: botBody.querySelector("strong:not(.message-heading)")?.textContent,
                    codeText: botBody.querySelector("code")?.textContent,
                    heading: botBody.querySelector(".message-heading")?.textContent,
                    linkText: botBody.querySelector("a")?.textContent,
                    linkHref: botBody.querySelector("a")?.href,
                    scriptCount: botBody.querySelectorAll("script").length,
                    visibleText: botBody.textContent,
                    unsafeScriptRan: Boolean(window.__unsafeGuideScript),
                    suggestionsHidden: shadow.querySelector("#suggestions").hidden,
                    messagesBusy: shadow.querySelector("#messages").getAttribute("aria-busy"),
                    payload,
                };
            }"""
        )
        assert response_state["boldText"] == "Thirdle"
        assert response_state["codeText"] == "Python"
        assert response_state["heading"] == "Projects"
        assert response_state["linkText"] == "Open project"
        assert response_state["linkHref"] == "https://example.com/project?q=guide&view=full"
        assert response_state["scriptCount"] == 0
        assert "<script>" in response_state["visibleText"]
        assert not response_state["unsafeScriptRan"]
        assert response_state["suggestionsHidden"]
        assert response_state["messagesBusy"] == "false"
        assert response_state["payload"]["current_page_url"].endswith("/index.html")
        assert response_state["payload"]["current_page_title"]
        assert response_state["payload"]["text"] == "What projects has Jacob built?"
        assert response_state["payload"]["info_url"].endswith(
            "/portfolio-guide-context.html"
        )
        assert response_state["payload"]["answer_scope"] == (
            "portfolio_first_general_knowledge"
        )
        assert response_state["payload"]["allow_general_knowledge"] is True
        assert any(
            link["url"].endswith("/tiktok-extractor.html")
            for link in response_state["payload"]["page_context"]["links"]
        )

        messages_before_close = page.locator(
            "#mcp-widget-host >> .message"
        ).count()
        page.locator("#mcp-widget-host >> #close-btn").click()
        page.evaluate(
            "document.querySelector('#mcp-widget-host').shadowRoot.querySelector('#fab-btn').click()"
        )
        assert page.locator("#mcp-widget-host >> .message").count() == messages_before_close

        page.reload(wait_until="domcontentloaded")
        page.evaluate("window.scrollTo(0, 300)")
        page.evaluate(
            "document.querySelector('#mcp-widget-host').shadowRoot.querySelector('#fab-btn').click()"
        )
        assert page.locator("#mcp-widget-host >> .message").count() == 1

        page.goto(EXTRACTOR_URL, wait_until="domcontentloaded")
        assert not page.locator("#mcp-widget-host").count()
        browser.close()


@pytest.mark.skipif(
    os.environ.get("RUN_E2E_WIDGET") != "1",
    reason="Set RUN_E2E_WIDGET=1 after starting the static server.",
)
def test_portfolio_guide_mobile_input_does_not_trigger_browser_zoom():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.add_init_script(
            r"""(() => {
                class IdleWebSocket extends EventTarget {
                    static OPEN = 1;

                    constructor() {
                        super();
                        this.readyState = IdleWebSocket.OPEN;
                        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
                    }

                    send() {}
                }

                window.WebSocket = IdleWebSocket;
            })();"""
        )
        page.goto(PORTFOLIO_URL, wait_until="domcontentloaded")
        page.evaluate("window.scrollTo(0, 300)")
        page.locator("#mcp-widget-host >> #fab-btn").click()

        state = page.evaluate(
            """() => {
                const host = document.querySelector("#mcp-widget-host");
                const input = host.shadowRoot.querySelector("#user-input");
                return {
                    fontSize: getComputedStyle(input).fontSize,
                    focused: host.shadowRoot.activeElement === input,
                };
            }"""
        )

        assert state["fontSize"] == "16px"
        assert state["focused"]
        browser.close()


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_GUIDE_EVAL") != "1",
    reason="Set RUN_LIVE_GUIDE_EVAL=1 after deploying the knowledge source.",
)
def test_deployed_portfolio_guide_answers_quality_cases():
    cases = json.loads(GUIDE_CASES_PATH.read_text(encoding="utf-8"))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page()
        page.goto(LIVE_GUIDE_URL, wait_until="domcontentloaded")
        page.evaluate("window.scrollTo(0, 300)")
        page.locator("#mcp-widget-host >> #fab-btn").click()
        user_input = page.locator("#mcp-widget-host >> #user-input")
        send_button = page.locator("#mcp-widget-host >> #send-btn")

        failures = []
        for case in cases:
            user_input.fill(case["question"])
            send_button.click()
            page.wait_for_function(
                """() => !document.querySelector("#mcp-widget-host")
                    .shadowRoot.querySelector("#send-btn").disabled""",
                timeout=60_000,
            )
            answer = page.locator(
                "#mcp-widget-host >> .message.bot .message-body"
            ).last.inner_text()
            missing = [
                term for term in case["required_terms"]
                if term.casefold() not in answer.casefold()
            ]
            if missing:
                failures.append(
                    f'{case["id"]}: missing {missing} from answer {answer!r}'
                )

        browser.close()

    assert not failures, "\n".join(failures)


@pytest.mark.skipif(
    os.environ.get("RUN_E2E") != "1",
    reason="Set RUN_E2E=1 after starting the local API and static servers.",
)
def test_tiktok_extractor_in_real_browser():
    console_errors = []
    page_errors = []
    api_responses = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page()
        page.add_init_script(
            """(() => {
                Object.defineProperty(navigator, "canShare", {
                    configurable: true,
                    value: (data) => Boolean(data && data.files && data.files.length)
                });
                Object.defineProperty(navigator, "share", {
                    configurable: true,
                    value: async (data) => {
                        const file = data.files[0];
                        window.__sharedRecipeCard = {
                            filename: file.name,
                            type: file.type,
                            size: file.size
                        };
                    }
                });
            })();"""
        )
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "response",
            lambda response: api_responses.append(response)
            if response.url.endswith("/api/extract")
            else None,
        )

        page.goto(EXTRACTOR_URL, wait_until="networkidle")
        page.locator("#video-url").fill(TIKTOK_URL)

        page.locator("#fetch-button").click()
        page.wait_for_timeout(5_000)

        script_state = page.evaluate(
            """() => ({
                fetchFunction: typeof fetchMetadataAndPopulate,
                buttonBinding: typeof fetchButton,
                sameButton: typeof fetchButton === "undefined"
                    ? false
                    : fetchButton === document.getElementById("fetch-button")
            })"""
        )
        assert api_responses, (
            f"No API request. status={page.locator('#extractor-status').inner_text()!r}; "
            f"button_text={page.locator('#fetch-button').inner_text()!r}; "
            f"button_disabled={page.locator('#fetch-button').is_disabled()!r}; "
            f"script_state={script_state!r}; console_errors={console_errors!r}; "
            f"page_errors={page_errors!r}"
        )
        assert api_responses[-1].status == 200
        page.locator("#extractor-status").get_by_text(
            "Extracted: 11 ingredient(s), 10 step(s), 0 note(s)."
        ).wait_for()

        assert page.locator("#title-output").inner_text() == "Chocolate chip banana bread"
        assert page.locator("#ingredients-output > li").count() == 11
        assert page.locator("#steps-output > li").count() == 10
        assert "1/4 tsp salt" in page.locator("#ingredients-output > li").last.inner_text()
        assert "Cool in pan 15 minutes" in page.locator("#steps-output > li").last.inner_text()
        assert not console_errors

        page.locator(".app-grid").screenshot(path="/private/tmp/tiktok-extractor-e2e.png")
        with page.expect_download() as download_info:
            page.locator("#download-image-button").click()
        download = download_info.value
        assert download.suggested_filename == "Chocolate chip banana bread.png"
        download.save_as("/private/tmp/Chocolate chip banana bread.png")

        page.locator("#share-image-button").click()
        page.wait_for_function("window.__sharedRecipeCard && window.__sharedRecipeCard.size > 0")
        shared_card = page.evaluate("window.__sharedRecipeCard")
        assert shared_card["filename"] == "Chocolate chip banana bread.png"
        assert shared_card["type"] == "image/png"
        assert "choose Save Image" in page.locator("#extractor-status").inner_text()

        metadata_buttons = page.locator("#fetch-button").locator("xpath=parent::*")
        assert metadata_buttons.locator("#clear-button").count() == 1
        page.locator("#clear-button").click()
        assert page.locator("#video-url").input_value() == ""
        assert page.locator("#recipe-input").input_value() == ""
        assert page.locator("#recipe-output").input_value() == ""
        assert page.locator("#template-image").input_value() == ""
        assert page.locator("#title-output").inner_text() == "Extracted Recipe"
        assert page.locator("#ingredients-output > li").inner_text() == "Paste recipe text and click Extract."
        assert page.locator("#steps-output > li").inner_text() == "Steps will appear here."
        browser.close()


@pytest.mark.skipif(
    os.environ.get("RUN_E2E") != "1",
    reason="Set RUN_E2E=1 after starting the local API and static servers.",
)
def test_promotional_caption_is_cleaned_in_real_browser():
    page_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(EXTRACTOR_URL, wait_until="networkidle")
        page.locator("#video-url").fill(SLOPPY_JOE_URL)
        page.locator("#fetch-button").click()

        page.locator("#extractor-status").get_by_text(
            "Extracted: 14 ingredient(s), 7 step(s), 0 note(s)."
        ).wait_for(timeout=30_000)
        assert page.locator("#title-output").inner_text() == "Sloppy Joe Potato Skillet"
        assert page.locator("#ingredients-output > li").count() == 14
        assert page.locator("#steps-output > li").count() == 7
        assert not page_errors

        with page.expect_download() as download_info:
            page.locator("#download-image-button").click()
        download = download_info.value
        assert download.suggested_filename == "Sloppy Joe Potato Skillet.png"
        download.save_as("/private/tmp/Sloppy Joe Potato Skillet.png")
        browser.close()


@pytest.mark.skipif(
    os.environ.get("RUN_E2E") != "1",
    reason="Set RUN_E2E=1 after starting the local API and static servers.",
)
def test_repeated_title_before_ingredients_wins_in_real_browser():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME_PATH),
            headless=True,
        )
        page = browser.new_page()
        page.goto(EXTRACTOR_URL, wait_until="networkidle")
        page.locator("#video-url").fill(CREAMY_CHICKEN_PASTA_URL)
        page.locator("#fetch-button").click()

        page.locator("#title-output").get_by_text(
            "One Pot Creamy Chicken Pasta", exact=True
        ).wait_for(timeout=30_000)
        assert "Here is my" not in page.locator("#title-output").inner_text()

        with page.expect_download() as download_info:
            page.locator("#download-image-button").click()
        download = download_info.value
        assert download.suggested_filename == "One Pot Creamy Chicken Pasta.png"
        download.save_as("/private/tmp/One Pot Creamy Chicken Pasta.png")
        browser.close()
