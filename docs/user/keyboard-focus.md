# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

Opening a file in the side panel leaves focus in the composer, so `mod+f` still finds in the
thread. Click the file first, and `mod+f` finds inside it instead.
