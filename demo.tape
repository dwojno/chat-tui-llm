# Demo recording script for the README GIF.
#
# Regenerate with:  vhs demo.tape   →   writes docs/demo.gif
# Needs the `vhs` binary (https://github.com/charmbracelet/vhs), an
# OPENAI_API_KEY in .env, and the RAG services running (`pnpm infra:start`).
# The session below makes real model calls and indexes a real file.
#
# The prompts walk the visible machinery end to end: the @file autocomplete,
# the /learn → /sources → knowledge-base-search RAG loop, the profile and
# conversation pickers, and a delegation whose sub-agent activity streams back.
#
# VHS timing notes:
#  - Sleeps after a message must outlast the real turn — while a turn streams
#    the prompt is inactive and keystrokes are dropped, not buffered.
#  - A command that ends on an @mention keeps the file-suggestion menu open, and
#    Enter then accepts the highlighted file instead of submitting. End such a
#    line with a trailing space (or Tab-accept) so Enter submits.
#  - Esc does NOT dismiss the picker overlay, so each picker is closed by
#    selecting the already-current entry (a no-op that keeps the transcript).

Output docs/demo.gif

Set Shell "zsh"
Set FontSize 16
Set Width 1200
Set Height 800
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 55ms

# Boot the TUI off-camera so the GIF opens on a clean prompt.
Hide
Type "pnpm start"
Enter
Sleep 3s
Show

# 1) @file — type a partial @mention, let the autocomplete menu appear, Tab to
#    complete it, then send. The file's contents are inlined into the turn.
Type "Give me a one-line summary of @READ"
Sleep 2s
Tab
Sleep 1s
Enter
Sleep 3s

# 2) /learn — convert, chunk, embed and index a source into the knowledge base.
#    Trailing space closes the @-file menu so Enter submits (see timing notes).
Type "/learn @docs/architecture.md "
Enter
Sleep 3s

# 3) /sources — list what's indexed in the current profile.
Type "/sources"
Enter
Sleep 2s

# 4) A knowledge-base question — shows the "search_knowledge_base" step and a
#    reranked, on-topic answer drawn from the file just indexed.
Type "From the docs I just indexed, how does context-window management work?"
Enter
Sleep 3s

# 5) /profile — the interactive picker (each profile = its own bucket +
#    collection + facts). Arrow through the list, land back on the current
#    profile, and select it (a no-op that closes the picker; Esc can't).
Type "/profile"
Enter
Sleep 500ms
Down
Sleep 500ms
Up
Sleep 500ms
Enter
Sleep 500ms

# 6) /conversation — separate chat threads (sessions) inside a profile. Reselect
#    the current thread to close the picker.
Type "/conversation"
Enter
Sleep 1500ms
Enter
Sleep 2s

# 7) A multi-step research turn — "Delegating: …" with the sub-agent's
#    "Searching the web" step nested underneath, then the synthesized answer.
Type "Compare server-side rendering and static site generation, and recommend one for a personal blog."
Enter
Sleep 30s

Type "exit"
Enter
Sleep 1500ms
