# Demo recording script for the README GIF.
#
# Regenerate with:  vhs demo.tape   →   writes docs/demo.gif
# Needs the `vhs` binary (https://github.com/charmbracelet/vhs), an
# OPENAI_API_KEY in .env, and the RAG services running (`pnpm infra:start`).
# The session below makes real model calls and indexes a real file.
#
# The prompts walk the visible machinery end to end: the @file autocomplete,
# the /learn → /sources → knowledge-base-search RAG loop, the two human-in-the-
# loop gates (a clarifying question and a tool-approval prompt), the profile and
# conversation pickers, and a delegation whose sub-agent activity streams back.
#
# VHS timing notes:
#  - Sleeps after a message must outlast the real turn — while a turn streams
#    the prompt is inactive and keystrokes are dropped, not buffered. The
#    orchestrator is a reasoning model, so turns are slow; the sleeps are long
#    (the model-call sleeps below are the ones measured live in rec.tape).
#  - A command that ends on an @mention keeps the file-suggestion menu open, and
#    Enter then accepts the highlighted file instead of submitting. End such a
#    line with a trailing space (or Tab-accept) so Enter submits.
#  - Esc does NOT dismiss the picker overlay, so each picker is closed by
#    selecting the already-current entry (a no-op that keeps the transcript).
#  - The two gate overlays consume keystrokes directly (no prompt is shown):
#      · approval overlay (yellow "Approve action? —") → press "a" approve,
#        "r" reject, "y" always; single key, no Enter.
#      · clarification with options (cyan picker) → j/k + Enter, or a digit.
#      · clarification without options → free-text prompt: type, then Enter.
#    The model only asks a clarifying question when it can't safely default, so
#    these prompts ask it to check with us first to keep the recording reliable.

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
Sleep 6.5s

# 2) /learn — convert, chunk, embed and index a source into the knowledge base.
#    Trailing space closes the @-file menu so Enter submits (see timing notes).
Type "/learn @docs/architecture.md "
Enter
Sleep 5.5s

# 3) /sources — list what's indexed in the current profile.
Type "/sources"
Enter
Sleep 5s

# 4) A knowledge-base question — shows the "search_knowledge_base" step and a
#    reranked, on-topic answer drawn from the file just indexed.
Type "From the docs I just indexed, how does context-window management work?"
Enter
Sleep 30s

# 5) Clarifying question — the agent pauses and asks before guessing. The
#    request carries preset options, so a cyan picker overlay appears
#    ("Asking you a question"); arrow to a choice and Enter to answer, and the
#    turn resumes with the reply folded in.
Type "Suggest a color theme for the docs site, but first ask me whether I want light or dark."
Enter
Sleep 2.5s
Down
Sleep 500ms
Enter
Sleep 8s

# 6) Tool approval — a file write ALWAYS pauses at the approval gate. The yellow
#    overlay shows the action, path and risk; press "a" to approve (single key,
#    no Enter). "r" would reject and "y" would always-allow this tool.
Type "Create a file called notes.txt containing the line: hello from vhs."
Enter
Sleep 3s
Type "a"
Sleep 10s

# 7) /profile — the interactive picker (each profile = its own bucket +
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
Sleep 3.5s

# 8) /conversation — separate chat threads (sessions) inside a profile. Reselect
#    the current thread to close the picker.
Type "/conversation"
Enter
Sleep 1500ms
Enter
Sleep 5.5s

# 9) A multi-step research turn — "Delegating: …" with the sub-agent's
#    "Searching the web" step nested underneath, then the synthesized answer.
Type "Compare server-side rendering and static site generation, and recommend one for a personal blog."
Enter
Sleep 30s

Type "exit"
Enter
Sleep 1500ms

# Clean up the file the approval demo wrote (back at the shell now).
Hide
Type "rm -f notes.txt"
Enter
Sleep 500ms
