from PIL import Image, ImageDraw, ImageFont
import numpy as np
from skimage.feature import hog
from skimage.filters import threshold_sauvola

class Hash:
    def __init__(self, h: str):
        self.h = [float(i) for i in h.split("::")]

    def __sub__(self, other):
        all = []
        for a, b in list(zip(self.h, other.h)):
            all.append(abs(float(a) - float(b)))
        return sum(all)

    def __str__(self):
        return "::".join([str(a) for a in self.h])

def divide_text_into_chunks(text, n):
    # Calculate the length of each chunk
    chunk_size = max(1, len(text) // n)

    # Split the text into chunks
    chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]

    while len(chunks) - 1 < n:
        chunks.append(',')  # TODO: figure out the most neutral character

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
        # Create an image for each letter
        img = Image.new('RGB', (font_size, font_size), color='white')
        d = ImageDraw.Draw(img)
        d.text((0, 0), letter, fill='black', font=font)

        # Calculate the width of the letter
        letter_width = d.textlength(letter, font=font)

        # Convert the image to grayscale
        grayscale_img = img.convert('L')

        # Apply adaptive thresholding using Sauvola's method
        threshold = threshold_sauvola(np.array(grayscale_img), window_size=15, k=0.2)
        binary_img = np.array(grayscale_img > threshold, dtype=np.uint8) * 255

        # Count the number of black pixels and white pixels
        black_pixels = np.sum(binary_img == 0)
        white_pixels = np.sum(binary_img == 255)

        # Normalize the count by the width of the letter
        normalized_count = (black_pixels - white_pixels) / letter_width
        pixel_counts.append(float(normalized_count))

        # Extract HOG features from the binary image
        hog_features.append(hog(binary_img, orientations=8, pixels_per_cell=(5, 5), cells_per_block=(2, 2), block_norm='L2'))

    # Concatenate the pixel counts and HOG features
    features: np.ndarray = np.concatenate((np.array(pixel_counts), np.ravel(hog_features)))

    return Hash('::'.join(map(str, features)))


dais = spell_hash('dayys')
bark = spell_hash("bark")
days = spell_hash("days")
print(dais - days)
print(days - bark)