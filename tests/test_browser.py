import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright


CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
EXTRACTOR_URL = "http://127.0.0.1:8000/tiktok-extractor.html?api=http://127.0.0.1:5055"
TIKTOK_URL = "https://vt.tiktok.com/ZSXhRCN9p/"
SLOPPY_JOE_URL = "https://vt.tiktok.com/ZS434t6W7/"
CREAMY_CHICKEN_PASTA_URL = "https://vt.tiktok.com/ZS43VX9Dd/"


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
