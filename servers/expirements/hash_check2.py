from PIL import Image, ImageDraw, ImageFont
import numpy as np


class Hash:
    def __init__(self, h: str):
      self.h = [float(i) for i in h.split("-")]
    
    def __sub__(self, other):
        all = []
        for a, b in list(zip(self.h, other.h)):
            all.append(abs(float(a) - float(b)))
        return int(sum(all)/len(all))
    def __str__(self):
       return "-".join([str(a) for a in self.h])

def divide_text_into_chunks(text, n):
  # Calculate the length of each chunk
  chunk_size = max(1, len(text) // n)

  # Split the text into chunks
  chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
  while len(chunks)-1 < n:
    chunks.append(',') # TODO: figure out the most neutral character

  return chunks
def spell_hash(text: str, font_path: str = "servers/expirements/unifont-15.1.04.otf", font_size: int = 100) -> str:
    """
    Convert each letter in text to an image, count the number of black pixels per letter,
    divide the count by the width of the letter, and return it in the format NUMBER-NUMBER-NUMBER for a word.
    
    Args:
    text (str): The Unicode text to convert into an image.
    font_path (str): Optional. Path to a .ttf font file. Uses default font if None.
    font_size (int): Font size.
    
    Returns:
    str: A string representing the normalized number of black pixels per letter in the format NUMBER-NUMBER-NUMBER.
    """
    text = divide_text_into_chunks(text, 3)
    if font_path:
        font = ImageFont.truetype(font_path, font_size)
    else:
        font = ImageFont.load_default()
    
    pixel_counts = []
    
    for letter in text:
        # Create an image for each letter
        img = Image.new('RGB', (font_size, font_size), color='white')
        d = ImageDraw.Draw(img)
        d.text((0, 0), letter, fill='black', font=font)
        
        # Calculate the width of the letter
        letter_width = d.textlength(letter, font=font)
        
        # Convert the image to binary (1 for black, 0 for white) and use numpy for efficient pixel counting
        binary_img = np.array(img.convert('1'))
        
        # Count the number of black pixels
        black_pixels = np.sum(binary_img == 0)
        white_pixels = np.sum(binary_img == 1)

        # Normalize the count by the width of the letter
        normalized_count = black_pixels - white_pixels
        pixel_counts.append(f"{float(normalized_count)}")
    
    # Return the counts in the desired format
    return Hash('-'.join(pixel_counts))

dais = spell_hash('dais')
bark = spell_hash("bark")
days = spell_hash("days")
print(dais - days)
print(dais - bark)