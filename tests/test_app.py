import io

import pytest
from PIL import Image

import app as recipe_app


@pytest.fixture()
def client():
    recipe_app.app.config.update(TESTING=True)
    return recipe_app.app.test_client()


@pytest.mark.parametrize(
    "url",
    [
        "https://www.tiktok.com/@cook/video/123",
        "https://vm.tiktok.com/abc123/",
        "http://tiktok.com/example",
    ],
)
def test_normalize_tiktok_url_accepts_tiktok_hosts(url):
    assert recipe_app.normalize_tiktok_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "",
        "www.tiktok.com/@cook/video/123",
        "https://example.com/video/123",
        "https://tiktok.com.example.com/video/123",
    ],
)
def test_normalize_tiktok_url_rejects_invalid_hosts(url):
    with pytest.raises(ValueError):
        recipe_app.normalize_tiktok_url(url)


def test_extract_recipe_with_explicit_sections():
    recipe = recipe_app.extract_recipe(
        "Chocolate Cake Ingredients: 2 cups flour, 1 cup sugar "
        "Instructions: 1. Mix ingredients. 2. Bake for 30 minutes."
    )

    assert recipe.title == "Chocolate Cake"
    assert recipe.ingredients == ["2 cups flour", "1 cup sugar"]
    assert recipe.steps == ["Mix ingredients", "Bake for 30 minutes"]


def test_extract_recipe_handles_tiktok_dash_lists_and_temperature_ranges():
    recipe = recipe_app.extract_recipe(
        "Banana Bread ✨🍌 A family favourite every time Ingredients - 3 ripe bananas, mashed "
        "- 1/2 cup butter, melted - 2 eggs, room temp "
        "Instructions - Preheat oven to 425°F. - Mix until smooth. "
        "- Bake for 50-60 minutes. • • • #recipe #baking #bananabread"
    )

    assert recipe.title == "Banana Bread"
    assert recipe.ingredients == [
        "3 ripe bananas, mashed",
        "1/2 cup butter, melted",
        "2 eggs, room temp",
    ]
    assert recipe.steps == [
        "Preheat oven to 425°F",
        "Mix until smooth",
        "Bake for 50-60 minutes",
    ]


def test_extract_recipe_removes_promotional_fluff_and_uses_loose_headings():
    caption = (
        "If you need an easy dinner recipe using a pound of ground beef, this "
        "Sloppy Joe Potato Skillet won’t disappoint!  INGREDIENTS  "
        "5 small/medium potatoes olive oil + salt, pepper, garlic powder, and paprika "
        "(for potatoes) 1 lb ground beef  1 chopped onion  1/2 tsp each of salt and pepper  "
        "1 tsp onion powder and paprika  1 tbsp minced garlic  1-2 tbsp Worcestershire  "
        "8 oz can tomato sauce  1/4 cup ketchup  1 tbsp mustard  2 tbsp bbq sauce  "
        "1 1/2 cups shredded Colby Jack cheese  Dried parsley  INSTRUCTIONS  "
        "Peel, wash, and cut potatoes up into cubes.  Toss them with olive oil, salt, "
        "pepper, garlic powder, and paprika.  Cook the potatoes in the air fryer at 400 "
        "degrees F for about 20-25 minutes.  Brown the ground beef and onion in a skillet.  "
        "Add minced garlic and sauces.  Add crispy potatoes to the skillet.  "
        "Enjoy! #easyrecipes #dinner #sloppyjoes"
    )

    recipe = recipe_app.extract_recipe(caption)

    assert recipe.title == "Sloppy Joe Potato Skillet"
    assert len(recipe.ingredients) == 14
    assert recipe.ingredients[:3] == [
        "5 small/medium potatoes",
        "olive oil + salt, pepper, garlic powder, and paprika (for potatoes)",
        "1 lb ground beef",
    ]
    assert "1 1/2 cups shredded Colby Jack cheese" in recipe.ingredients
    assert len(recipe.steps) == 7
    assert recipe.steps[-1] == "Enjoy!"


def test_title_immediately_before_ingredients_beats_introductory_fluff():
    caption = (
        "Here is my One Pot Creamy Chicken Pasta Dinner 🤤🍝 full recipe on my website. "
        "Crispy chicken over rich, creamy pasta. Easy comfort food made in one pot! "
        "No mess no stress dinner 😊 One Pot Creamy Chicken Pasta:  "
        "Ingredients Chicken 2 chicken breasts  1 tbsp olive oil  "
        "Instructions Season the chicken.  Cook the pasta."
    )

    recipe = recipe_app.extract_recipe(caption)

    assert recipe.title == "One Pot Creamy Chicken Pasta"


def test_api_extract_returns_structured_recipe(client, monkeypatch):
    monkeypatch.setattr(
        recipe_app,
        "fetch_metadata_from_tiktok",
        lambda _url: {
            "caption": (
                "Tomato Pasta Ingredients: 200 g pasta, 1 can tomatoes "
                "Instructions: 1. Boil pasta. 2. Stir in tomatoes."
            ),
            "thumbnail_url": "https://example.com/thumb.jpg",
        },
    )

    response = client.post(
        "/api/extract",
        json={"video_url": "https://www.tiktok.com/@cook/video/123"},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["recipe"]["title"] == "Tomato Pasta"
    assert payload["recipe"]["ingredients"] == ["200 g pasta", "1 can tomatoes"]
    assert payload["thumbnail_url"] == "https://example.com/thumb.jpg"
    assert response.headers["Access-Control-Allow-Origin"] == "*"


def test_api_extract_returns_json_error(client):
    response = client.post("/api/extract", json={"video_url": "https://example.com"})

    assert response.status_code == 400
    assert response.is_json
    assert "TikTok URL" in response.get_json()["error"]


def test_text_download(client):
    response = client.post("/download/txt", data={"recipe_text": "Test recipe"})

    assert response.status_code == 200
    assert response.data == b"Test recipe"
    assert "recipe.txt" in response.headers["Content-Disposition"]


def test_image_download(client):
    template = io.BytesIO()
    Image.new("RGB", (400, 500), "white").save(template, format="PNG")
    template.seek(0)

    response = client.post(
        "/download/image",
        data={
            "recipe_text": "Toast\n\nIngredients\n- 2 slices bread",
            "template_image": (template, "template.png"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert response.data.startswith(b"\x89PNG")


def test_default_image_uses_title_filename_and_omits_source_caption(client):
    recipe_text = (
        "Chocolate chip banana bread\n\n"
        "Ingredients\n- 3 bananas\n\n"
        "Instructions\n1. Mash and bake.\n\n"
        "Source Caption\nThis text must not appear on the image."
    )

    response = client.post("/download/image", data={"recipe_text": recipe_text})

    assert response.status_code == 200
    assert "Chocolate chip banana bread.png" in response.headers["Content-Disposition"]
    rendered = Image.open(io.BytesIO(response.data))
    assert rendered.width == 736
    assert rendered.height >= 1104
    logo_size = max(62, int(rendered.width * 0.095))
    logo_bottom_offset = max(110, int(rendered.width * 0.15))
    logo_sample = rendered.getpixel(
        (
            rendered.width // 2 - int(logo_size * 0.38),
            rendered.height - logo_bottom_offset - logo_size // 2,
        )
    )
    assert max(logo_sample[:3]) < 190
    assert recipe_app._image_only_recipe_text(recipe_text).endswith("Mash and bake.")
    assert "Source Caption" not in recipe_app._image_only_recipe_text(recipe_text)


def test_image_filename_falls_back_when_title_is_unusable():
    assert recipe_app._safe_recipe_filename('  \\ / : * ? " < > |  ') == "TikTokRecipe"
    assert recipe_app._safe_recipe_filename("Extracted Recipe") == "TikTokRecipe"
