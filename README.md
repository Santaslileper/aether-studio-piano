# Aether Studio Piano - GitHub Pages Version

This directory contains the minified, static version of Aether Studio Piano, optimized for hosting on **GitHub Pages**.

## 🚀 Deployment Instructions
1.  **Upload to GitHub**: Create a new repository (or a new branch like `gh-pages`) and upload the contents of this folder.
2.  **Enable Pages**: Go to your Repository Settings > Pages and select the branch you uploaded to.
3.  **No Configuration Needed**: The app is built with **Relative Paths** (`./assets/`), so it will work whether you host it on a custom domain or a subfolder (e.g., `username.github.io/aether-piano/`).

## 🎹 Important Notes
- **Static Hosting**: Since GitHub Pages is static, the **BitMidi Search** and **MIDI Downloads** features will show a "Server offline" message unless you have the `server.js` proxy running locally on your computer.
- **Local Playback**: All pre-loaded songs (Rush E, Aurora, moonlight sonata, etc.) will work perfectly out of the box.
- **No Jekyll**: I've included a `.nojekyll` file to ensure GitHub doesn't interfere with the minified JavaScript bundles.

Enjoy your digital music desk!
