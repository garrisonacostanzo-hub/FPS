using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

namespace FPS.UI
{
    /// <summary>
    /// Code-first uGUI construction helpers. Every menu and HUD element is built from these, so UI needs no prefab
    /// wiring and can be re-themed entirely from <see cref="Data.HUDTheme"/>.
    /// </summary>
    public static class UIFactory
    {
        private static Font s_Font;
        private static Sprite s_WhiteSprite;
        private static Sprite s_RingSprite;

        public static Font DefaultFont
        {
            get
            {
                if (s_Font == null)
                {
                    s_Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                }

                return s_Font;
            }
        }

        public static Sprite WhiteSprite
        {
            get
            {
                if (s_WhiteSprite == null)
                {
                    Texture2D texture = Texture2D.whiteTexture;
                    s_WhiteSprite = Sprite.Create(texture, new Rect(0f, 0f, texture.width, texture.height), new Vector2(0.5f, 0.5f));
                }

                return s_WhiteSprite;
            }
        }

        /// <summary>Anti-aliased ring sprite generated at runtime (circle crosshair, objective markers).</summary>
        public static Sprite RingSprite
        {
            get
            {
                if (s_RingSprite == null)
                {
                    const int size = 128;
                    var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
                    var pixels = new Color32[size * size];
                    float outer = size * 0.5f - 1f;
                    float inner = outer - 7f;
                    for (int y = 0; y < size; y++)
                    {
                        for (int x = 0; x < size; x++)
                        {
                            float dx = x - size * 0.5f + 0.5f;
                            float dy = y - size * 0.5f + 0.5f;
                            float distance = Mathf.Sqrt(dx * dx + dy * dy);
                            float alpha = Mathf.Clamp01(outer - distance + 0.5f) * Mathf.Clamp01(distance - inner + 0.5f);
                            pixels[y * size + x] = new Color32(255, 255, 255, (byte)(alpha * 255f));
                        }
                    }

                    texture.SetPixels32(pixels);
                    texture.Apply();
                    s_RingSprite = Sprite.Create(texture, new Rect(0f, 0f, size, size), new Vector2(0.5f, 0.5f));
                }

                return s_RingSprite;
            }
        }

        public static Canvas CreateCanvas(string name, int sortingOrder, Transform parent = null)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            if (parent != null)
            {
                go.transform.SetParent(parent, false);
            }

            var canvas = go.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = sortingOrder;
            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;
            return canvas;
        }

        public static RectTransform CreateRect(string name, Transform parent, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = go.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = anchor;
            rect.anchorMax = anchor;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        public static RectTransform Stretch(RectTransform rect, float padding = 0f)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.offsetMin = new Vector2(padding, padding);
            rect.offsetMax = new Vector2(-padding, -padding);
            return rect;
        }

        public static Image CreateImage(string name, Transform parent, Color color, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size)
        {
            RectTransform rect = CreateRect(name, parent, anchor, pivot, position, size);
            var image = rect.gameObject.AddComponent<Image>();
            image.sprite = WhiteSprite;
            image.color = color;
            image.raycastTarget = false;
            return image;
        }

        public static Image CreateFilledBar(string name, Transform parent, Color background, Color fill, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size, out Image fillImage)
        {
            Image back = CreateImage(name, parent, background, anchor, pivot, position, size);
            fillImage = CreateImage("Fill", back.transform, fill, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), Vector2.zero, size);
            Stretch(fillImage.rectTransform, 2f);
            fillImage.type = Image.Type.Filled;
            fillImage.fillMethod = Image.FillMethod.Horizontal;
            fillImage.fillOrigin = (int)Image.OriginHorizontal.Left;
            fillImage.fillAmount = 1f;
            return back;
        }

        public static Text CreateText(string name, Transform parent, string content, int fontSize, TextAnchor alignment, Color color,
            Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size, bool outline = true)
        {
            RectTransform rect = CreateRect(name, parent, anchor, pivot, position, size);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = DefaultFont;
            text.text = content;
            text.fontSize = fontSize;
            text.alignment = alignment;
            text.color = color;
            text.raycastTarget = false;
            text.supportRichText = true;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            if (outline)
            {
                var shadow = rect.gameObject.AddComponent<Shadow>();
                shadow.effectColor = new Color(0f, 0f, 0f, 0.65f);
                shadow.effectDistance = new Vector2(1.5f, -1.5f);
            }

            return text;
        }

        public static Button CreateButton(string name, Transform parent, string label, Action onClick, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size,
            Color background, Color textColor, int fontSize = 24)
        {
            Image image = CreateImage(name, parent, background, anchor, pivot, position, size);
            image.raycastTarget = true;
            var button = image.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            ColorBlock colors = button.colors;
            colors.normalColor = Color.white;
            colors.highlightedColor = new Color(1.15f, 1.15f, 1.15f, 1f);
            colors.pressedColor = new Color(0.8f, 0.8f, 0.8f, 1f);
            colors.selectedColor = new Color(1.1f, 1.1f, 1.1f, 1f);
            colors.colorMultiplier = 1.2f;
            button.colors = colors;
            if (onClick != null)
            {
                button.onClick.AddListener(() => onClick());
            }

            Text text = CreateText("Label", image.transform, label, fontSize, TextAnchor.MiddleCenter, textColor, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size, false);
            Stretch(text.rectTransform);
            return button;
        }

        public static Slider CreateSlider(string name, Transform parent, float min, float max, float value, Action<float> onChanged,
            Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size, Color fillColor)
        {
            RectTransform root = CreateRect(name, parent, anchor, pivot, position, size);
            Image background = CreateImage("Background", root, new Color(1f, 1f, 1f, 0.15f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size);
            Stretch(background.rectTransform);
            background.rectTransform.offsetMin = new Vector2(0f, size.y * 0.35f);
            background.rectTransform.offsetMax = new Vector2(0f, -size.y * 0.35f);

            RectTransform fillArea = CreateRect("Fill Area", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size);
            Stretch(fillArea);
            fillArea.offsetMin = new Vector2(0f, size.y * 0.35f);
            fillArea.offsetMax = new Vector2(0f, -size.y * 0.35f);
            Image fill = CreateImage("Fill", fillArea, fillColor, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), Vector2.zero, Vector2.zero);
            fill.rectTransform.anchorMin = Vector2.zero;
            fill.rectTransform.anchorMax = new Vector2(0f, 1f);
            fill.rectTransform.sizeDelta = Vector2.zero;

            RectTransform handleArea = CreateRect("Handle Slide Area", root, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size);
            Stretch(handleArea);
            Image handle = CreateImage("Handle", handleArea, Color.white, new Vector2(0f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(size.y * 0.6f, 0f));
            handle.rectTransform.anchorMin = new Vector2(0f, 0f);
            handle.rectTransform.anchorMax = new Vector2(0f, 1f);
            handle.raycastTarget = true;

            var slider = root.gameObject.AddComponent<Slider>();
            slider.fillRect = fill.rectTransform;
            slider.handleRect = handle.rectTransform;
            slider.targetGraphic = handle;
            slider.direction = Slider.Direction.LeftToRight;
            slider.minValue = min;
            slider.maxValue = max;
            slider.value = value;
            if (onChanged != null)
            {
                slider.onValueChanged.AddListener(v => onChanged(v));
            }

            return slider;
        }

        public static InputField CreateInputField(string name, Transform parent, string value, string placeholder, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size, int fontSize = 22)
        {
            Image background = CreateImage(name, parent, new Color(0f, 0f, 0f, 0.45f), anchor, pivot, position, size);
            background.raycastTarget = true;
            Text text = CreateText("Text", background.transform, value, fontSize, TextAnchor.MiddleLeft, Color.white, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size, false);
            Stretch(text.rectTransform, 8f);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            Text hint = CreateText("Placeholder", background.transform, placeholder, fontSize, TextAnchor.MiddleLeft, new Color(1f, 1f, 1f, 0.35f), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, size, false);
            Stretch(hint.rectTransform, 8f);
            hint.fontStyle = FontStyle.Italic;

            var field = background.gameObject.AddComponent<InputField>();
            field.textComponent = text;
            field.placeholder = hint;
            field.targetGraphic = background;
            field.text = value;
            return field;
        }

        public static Toggle CreateToggle(string name, Transform parent, string label, bool value, Action<bool> onChanged, Vector2 anchor, Vector2 pivot, Vector2 position, Vector2 size, Color accent)
        {
            RectTransform root = CreateRect(name, parent, anchor, pivot, position, size);
            Image box = CreateImage("Box", root, new Color(1f, 1f, 1f, 0.2f), new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), Vector2.zero, new Vector2(size.y, size.y));
            box.raycastTarget = true;
            Image check = CreateImage("Check", box.transform, accent, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(size.y * 0.6f, size.y * 0.6f));
            CreateText("Label", root, label, Mathf.RoundToInt(size.y * 0.7f), TextAnchor.MiddleLeft, Color.white, new Vector2(0f, 0.5f), new Vector2(0f, 0.5f), new Vector2(size.y + 10f, 0f), new Vector2(size.x - size.y - 10f, size.y), false);

            var toggle = root.gameObject.AddComponent<Toggle>();
            toggle.targetGraphic = box;
            toggle.graphic = check;
            toggle.isOn = value;
            if (onChanged != null)
            {
                toggle.onValueChanged.AddListener(v => onChanged(v));
            }

            return toggle;
        }

        public static void EnsureEventSystem()
        {
            if (EventSystem.current != null || UnityEngine.Object.FindAnyObjectByType<EventSystem>() != null)
            {
                return;
            }

            var go = new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
            UnityEngine.Object.DontDestroyOnLoad(go);
        }

        public static string ToHex(Color color)
        {
            return ColorUtility.ToHtmlStringRGB(color);
        }
    }
}
