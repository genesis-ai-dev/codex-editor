from PIL import Image, ImageDraw, ImageFont


class Hash:
    def __init__(self, h: str):
      self.h = [int(i) for i in h.split("-")]
    
    def __sub__(self, other):
        diff = 0
        for a, b in list(zip(self.h, other.h)):
            diff += abs(float(a) - float(b))
        return diff
    def __str__(self):
        return "-".join(self.h)

def divide_text_into_chunks(text, n):
    n = n -1
    # Calculate the length of each chunk
    chunk_size = len(text) // n

    # Split the text into chunks
    chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
    while len(chunks)-1 < n:
        chunks.append(text[-1])

    return chunks
def spell_hash(text: str, font_path: str = "servers/experiments/unifont-15.1.04.otf", font_size: int = 100) -> Hash:
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
    text = divide_text_into_chunks(text, 4)
    print(text)
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
        
        # Convert the image to binary (1 for black, 0 for white)
        binary_img = img.convert('1')
        
        # Count the number of black pixels
        black_pixels = sum(1 for pixel in binary_img.getdata() if pixel == 0)
        
        # Normalize the count by the width of the letter
        normalized_count = black_pixels / letter_width if letter_width > 0 else 0
        pixel_counts.append(f"{int(normalized_count**2)}")
    
    # Return the counts in the desired format
    return Hash('-'.join(pixel_counts))




# Example usage:
if __name__ == "__main__":
    namaste: Hash = spell_hash("नमस्ते")
    wrong1: Hash = spell_hash("नमस्तैतै")
    wrong2: Hash = spell_hash("नमस्तेय")
    paanee: Hash = spell_hash("पानी")

    print("result: ", namaste-wrong1)
    # returns 1  
    print("result: ", namaste-wrong2)
    # returns 7
    print("result: ", namaste-paanee)
    # returns 15