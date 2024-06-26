from openai import OpenAI



system = """
You are an AI language model trained to make minor edits to text based on provided examples. Your task is to analyze the given example edit and apply similar changes to a new text sample if possible.
Here is the example edit:
Old: {before}
New: {after}
"""
template = """
Focus on finding similar words or patterns to what appeared in the 'old' sample and how they were changed in the 'new' sample.
Simply output the new text, nothing else.
{text}
"""

client = OpenAI(base_url="http://localhost:1234/v1", api_key="not-needed")

def get_edit(before, after, text):
    completion = client.chat.completions.create(
        model="local-model",
        messages=[
            {"role": "system", "content": system.format(before=before, after=after)},
            {"role": "user", "content": template.format(text=text)}
        ],
        temperature=0.1,
    )

    return completion.choices[0].message.content

# before = "Zindagi mein kuch khaas lamhe aise hote hain jo hamesha yaad rehte hain, unki yaadon mein kho kar dil ko sukoon milta hai."
# after = "Zindagi mein kuch khaas pal aise bhi hote hain jo hamesha yaad rehte hain, unki yaadon mein kho kar dil ko sukoon milta hai."

# text = "Shaam ke lamhe nehar mein doobte hue suraj ki roshni mein kho gaye."
# get_edit(before, after, text)