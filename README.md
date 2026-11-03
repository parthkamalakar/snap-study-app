# Snap Study (local version)

A personal Class 6 tutor that runs entirely on your own computer. It uses a local AI model through Ollama. There is no cloud service, no account and no API key. After the model is downloaded once, it works offline.

You can send photos of textbook pages, homework and diagrams, chat about them, get notebook answers, and make practice questions, revision notes and flashcards.

## What you need

1. A computer with at least 8 GB of RAM (16 GB is better for bigger models).
2. [Node.js](https://nodejs.org) version 18 or newer.
3. [Ollama](https://ollama.com), which runs the AI model on your computer.

## Set up (once)

1. Install Ollama and open it so it is running.
2. Download a model that can read photos. Open a terminal and run one of these:

   ```
   ollama pull gemma3:4b
   ollama pull qwen2.5vl:7b
   ollama pull llama3.2-vision
   ```

   `gemma3:4b` is the smallest and works on most computers. `qwen2.5vl:7b` is better at reading text in photos. Newer photo-reading models appear on https://ollama.com/library often, so look there too.

## Start it

In this folder, run:

```
node server.js
```

Then open http://localhost:3000 in your browser.

Choose the model in Profile. Models marked "reads photos" can look at pictures. Models marked "text only" can answer typed questions but not photos.

## Good to know

- Local models are smaller than the big cloud ones. For maths, check the answer against your textbook, and try a bigger model if answers look wrong.
- Photos per message: the default is 4. Some models only handle one photo at a time (for example `llama3.2-vision`). Start the server with `MAX_IMAGES=1 node server.js` if you see strange answers with several photos.
- First answers can be slow while the model loads into memory. Photos make it slower.
- Hindi and Marathi work best with larger models. If they come out weak, use English.
- Your chats, profile and progress are saved only in your browser. Photos are not saved after you close the page.
- The server only accepts connections from this computer.

## Settings (optional)

Set these before `node server.js`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | Port for the page |
| `OLLAMA_HOST` | http://127.0.0.1:11434 | Where Ollama is running |
| `MAX_IMAGES` | 4 | Photos sent with each message |
| `NUM_CTX` | 8192 | How much text the model can remember in a chat |

## Files

- `server.js` serves the app, passes chat requests to Ollama, and turns Ollama failures into clear error codes (not running, model missing, model can't read photos, busy, out of memory).
- `public/index.html`, `public/styles.css`, `public/app.js` are the app (no build step, no internet needed).
- `the_snap_study_app.html`, `snap-study-app.html` and `snap-study-app.gemini-old.html.bak` are old prototypes that are not used. They can be deleted.
