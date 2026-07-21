# Description

An open source automated video creation tool for generating short-form video content. Short Video Maker combines text-to-speech, automatic captions, background videos, and music to create engaging short videos from simple text inputs.

This project is meant to provide a free alternative to heavy GPU-power hungry video generation (and a free alternative to expensive, third-party API calls). It doesn't generate a video from scratch based on an image or an image prompt.

Checkout more AI Related Videos in our Channel [WebSensePro](https://www.youtube.com/websensepro). We encourage you to check out the channel for more AI-related content and tutorials.

The server exposes an [MCP](https://github.com/modelcontextprotocol) and a REST server.

While the MCP server can be used with an AI Agent (like n8n) the REST endpoints provide more flexibility for video generation.

# TOC

## Getting started

- [How to run the server](#docker-command)
- [Web UI](#web-ui)
- [Examples](#examples)

## Usage

- [Environment variables](#environment-variables)

## Info

- [Features](#features)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Acknowledgements](#acknowledgments)

# Examples

[Check out the video 1](https://youtube.com/shorts/APF0Q75FeHA)

[Check out the video 2](https://youtube.com/shorts/GZi_3-bMZTI)

# Features

- Generate complete short videos from text prompts
- Text-to-speech conversion
- Automatic caption generation and styling
- Background video search and selection via Pexels
- Background music with genre/mood selection
- Serve as both REST API and Model Context Protocol (MCP) server

# How It Works

Shorts Creator takes simple text inputs and search terms, then:

1. Converts text to speech using Kokoro TTS
2. Generates accurate captions via Whisper
3. Finds relevant background videos from Pexels
4. Composes all elements with Remotion
5. Renders a professional-looking short video with perfectly timed captions

# Limitations

- The project only capable generating videos with English voiceover (kokoro-js doesn’t support other languages at the moment)
- The background videos are sourced from Pexels

# General Requirements

- internet
- free pexels api key
- ≥ 3 gb free RAM, my recommendation is 4gb RAM
- ≥ 2 vCPU
- ≥ 5gb disc space


## Scene

Each video is assembled from multiple scenes. These scenes consists of

1. Text: Narration, the text the TTS will read and create captions from.
2. Search terms: The keywords the server should use to find videos from Pexels API. If none can be found, joker terms are being used (`nature`, `globe`, `space`, `ocean`)



### Docker Command

```jsx
docker run -it --rm --name short-video-maker -p 3123:3123 -e LOG_LEVEL=debug -e PEXELS_API_KEY= bilalnaseer/free-video-maker:latest
```


# Web UI

Load web UI to generate videos here http://localhost:3123

# Environment variables

## 🟢 Configuration

| key             | description                                                     | default |
| --------------- | --------------------------------------------------------------- | ------- |
| PEXELS_API_KEY  | [your (free) Pexels API key](https://www.pexels.com/api/)       |         |
| LOG_LEVEL       | pino log level                                                  | info    |
| WHISPER_VERBOSE | whether the output of whisper.cpp should be forwarded to stdout | false   |
| PORT            | the port the server will listen on                              | 3123    |


## Acknowledgments

- ❤️ [ai_agents_az]((https://github.com/gyoridavid/ai_agents_az) AI Agents AZ is the original creator of this repo, which I forked to make it easier for my youtube audience.
