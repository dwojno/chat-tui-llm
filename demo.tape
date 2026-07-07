# Demo recording script for the README GIF.
#
# Regenerate with:  vhs demo.tape   →   writes docs/demo.gif
# Needs the `vhs` binary (https://github.com/charmbracelet/vhs) and an
# OPENAI_API_KEY in .env (the session below makes real model calls).
#
# The prompts are chosen to show off the visible machinery: a streamed answer,
# the live "thinking" trace of a tool call, and a delegation whose sub-agent
# tool activity streams back nested under the delegation step.

Output docs/demo.gif

Set Shell "zsh"
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 55ms

# Boot the TUI off-camera so the GIF opens on a clean prompt.
Hide
Type "pnpm start"
Enter
Sleep 3s
Show

# 1) A single-tool turn — shows the "Fetching weather data · Tokyo" step.
Type "What's the weather in Tokyo?"
Enter
Sleep 6s

# 2) A multi-step research turn — shows "Delegating: …" with the sub-agent's
#    "Searching the web" step nested underneath, then the synthesized answer.
Type "Compare server-side rendering and static site generation, and recommend one for a personal blog."
Enter
Sleep 14s

Type "exit"
Enter
Sleep 1500ms
