from openai import OpenAI



system = """
You are an AI trained to make minor text edits based on examples. Analyze the provided edit example and apply similar changes to new text when applicable.
Example edit:
Original: {before}
Revised: {after}
"""
template = """
Identify words or patterns in the new text similar to those in the original example. Apply comparable changes if relevant.
New text to edit:
{text}
Output only the edited text, with no additional commentary.
"""

client = OpenAI(api_key="")

def get_edit(before, after, text):
    completion = client.chat.completions.create(
        model="gpt-4o",
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