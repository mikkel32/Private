from image_renderer import render_chat_history
history = [{"role": "user", "content": "Hello, Ghost Protocol!"}, {"role": "assistant", "content": "I am completely hidden from Optical Character Recognition!"}]
out = render_chat_history(history)
with open("test_adversarial.png", "wb") as f:
    f.write(out)
print("Saved test_adversarial.png")
