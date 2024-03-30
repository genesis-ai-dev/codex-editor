from PIL import Image, ImageDraw, ImageFont
import numpy as np
from skimage.feature import hog
from skimage.filters import threshold_sauvola
from sklearn.decomposition import PCA
from sklearn.preprocessing import MinMaxScaler

class Hash:
    def __init__(self, h: str):
        self.h = [float(i) for i in h.split("::")]

    def __sub__(self, other):
        return sum(abs(float(a) - float(b)) for a, b in zip(self.h, other.h))

    def __str__(self):
        return "::".join(str(a) for a in self.h)

def divide_text_into_chunks(text, n):
    chunk_size = max(1, len(text) // n)
    chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
    chunks.extend([','] * (n - len(chunks)))
    return chunks

def spell_hash(text: str, font_path: str = "servers/experiments/unifont-15.1.04.otf", font_size: int = 100) -> Hash:
    """
    Convert each letter in text to an image, extract visual features, and return it as a Hash object.

    Args:
        text (str): The Unicode text to convert into an image.
        font_path (str): Optional. Path to a .ttf font file. Uses default font if None.
        font_size (int): Font size.

    Returns:
        Hash: A Hash object representing the visual features of the text.
    """
    text = divide_text_into_chunks(text, 3)

    if font_path:
        font = ImageFont.truetype(font_path, font_size)
    else:
        font = ImageFont.load_default()

    pixel_counts = []
    hog_features = []

    for letter in text:
        img = Image.new('RGB', (font_size, font_size), color='white')
        d = ImageDraw.Draw(img)
        d.text((0, 0), letter, fill='black', font=font)

        letter_width = d.textlength(letter, font=font)

        grayscale_img = img.convert('L')
        threshold = threshold_sauvola(np.array(grayscale_img), window_size=15, k=0.2)
        binary_img = np.array(grayscale_img > threshold, dtype=np.uint8) * 255

        black_pixels = np.sum(binary_img == 0)
        white_pixels = np.sum(binary_img == 255)

        normalized_count = (black_pixels - white_pixels) / letter_width
        pixel_counts.append(float(normalized_count))

        hog_features.append(hog(binary_img, orientations=4, pixels_per_cell=(10, 10), cells_per_block=(2, 2), block_norm='L2'))

    hog_features_flattened = np.array([feature.ravel() for feature in hog_features])
    n_components = min(len(hog_features_flattened), hog_features_flattened.shape[1])
    pca = PCA(n_components=n_components)
    hog_features_reduced = pca.fit_transform(hog_features_flattened)

    scaler = MinMaxScaler()
    pixel_counts_scaled = scaler.fit_transform(np.array(pixel_counts).reshape(-1, 1)).flatten()
    hog_features_scaled = scaler.fit_transform(hog_features_reduced)

    features = np.concatenate((pixel_counts_scaled, hog_features_scaled.ravel()))

    return Hash('::'.join(str(a) for a in features))

dais = spell_hash('dayys')
bark = spell_hash("bark")
days = spell_hash("days")
print(dais - days)
print(days - bark)
