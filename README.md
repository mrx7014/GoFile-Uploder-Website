<div align="center">

# ☁️ GoFile Uploader

### Upload a file. Get a link. Done.

A tiny, fast web UI for sending files to [GoFile](https://gofile.io) straight from your browser — no account, no ads, no setup.

[**🌐 Live Demo**](https://gofile-uploder-website.vercel.app/) · [**🐞 Report a Bug**](https://github.com/mrx7014/GoFile-Uploder-Website/issues) · [**💡 Request a Feature**](https://github.com/mrx7014/GoFile-Uploder-Website/issues)

![License](https://img.shields.io/github/license/mrx7014/GoFile-Uploder-Website?style=flat-square)
![Stars](https://img.shields.io/github/stars/mrx7014/GoFile-Uploder-Website?style=flat-square)
![Forks](https://img.shields.io/github/forks/mrx7014/GoFile-Uploder-Website?style=flat-square)
![Issues](https://img.shields.io/github/issues/mrx7014/GoFile-Uploder-Website?style=flat-square)

</div>

---

## Why this exists

GoFile is great for sharing big files, but you shouldn't need to open a heavy page just to drop a file and grab a link. This project gives you one clean screen that does exactly that, and nothing else. It works well on a phone, which is where most quick shares happen.

## Features

| | |
|---|---|
| 📤 **Direct upload** | Files go from your browser to GoFile |
| 🖱️ **Drag & drop** | Or use the regular file picker |
| 📊 **Live progress** | See the upload as it happens |
| 🔗 **Instant link** | Shareable download page link right after upload |
| 📋 **One-tap copy** | Copy the link without selecting text |
| 📱 **Responsive** | Phones, tablets, desktops |
| ⚡ **One-click deploy** | Your own copy on Vercel in about a minute |

## Quick start

### Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmrx7014%2FGoFile-Uploder-Website)

Vercel clones the repo into your GitHub account, builds it, and gives you a live URL.

## How it works

```
Browser ──► GoFile API ──► Download page link ──► Shown on screen
  pick        uploads        returned by            copy &
  a file      the file       GoFile                 share
```

1. You pick or drop a file.
2. The site uploads it to the GoFile API and tracks progress.
3. GoFile stores the file and returns a download page URL.
4. The URL is displayed so you can copy and share it.

## Project structure

```
GoFile-Uploder-Website/
├── index.html      # UI
├── ...             # scripts / styles
└── README.md
```

<!-- Update this tree to match the real files in the repo -->

Have an idea? [Open an issue](https://github.com/mrx7014/GoFile-Uploder-Website/issues).

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-idea`
3. Commit your changes: `git commit -m "Add my idea"`
4. Push and open a Pull Request

## Disclaimer

This is an independent, unofficial project and is **not affiliated with GoFile**. Follow GoFile's terms of service and only upload content you have the right to share.

## License

Distributed under the license in the [`LICENSE`](LICENSE) file.

## Author

- [MRX7014](https://github.com/mrx7014)

<div align="center">

If this saved you time, a ⭐ on the repo means a lot.

</div>
