---
title: "[]{#_nj23sjpj5u97 .anchor}Multimodal Chatbot Demo"
---

# Goal

The POC application needs to complete several things at once to function
properly:

-   Receive user input data from input device

    -   userInput: Text, audio, video data (user chooses).

    -   inputDevice: mic, camera, text (user chooses).

-   Send user input data to Live API.

-   Receive response data from Live API.

-   Send response data from Live API to output device.

    -   responseType: text or speech (user chooses).

    -   outputDevice: text or speaker (user chooses).

-   Handle interruptions.

# Tools

## Google Gen AI SDK

The Google Gen AI SDK can connect to Google's AI services in two main
ways:

1.  Through Vertex AI (Google Cloud users): Uses your Google Cloud
    > project credentials (usually set up via gcloud auth
    > application-default login).

2.  Using a Gemini API Key (For Google AI Studio users): If you are
    > using Google AI Studio, you must use a different model ID:
    > gemini-2.0-flash-exp.

We will be using Method 1.

gcloud auth application-default login

The Google Agent Development Kit (ADK) and the direct use of the Gemini
Live API serve different but complementary purposes in building AI
agents, particularly those requiring real-time voice and video
capabilities.

## LiveAPI

A specific, low-level service designed for real-time, interactive
applications. It enables speech-to-speech and live video input, making
it ideal for applications like voice assistants or live video
conferencing where immediate response is critical.

\*To use voice or video streaming features within the ADK, developers
must specifically use a Gemini model that supports the Live API, such as
gemini-2.0-flash-live-001.

1.  Bi-directional streaming - data moves continuously in both
    > directions.

2.  Multimodal:

    a.  Input: Text, audio, video (camera and screen share).

    b.  Output: Text and audio.

## Google ADK (Agent Development Kit)

A comprehensive framework designed for building, managing, and deploying
sophisticated AI agents, including multi-agent systems. Capabilities
include:

-   Define agent logic, tools, and orchestration directly in Python for
    > flexibility and testability.

-   Supports integration with various Large Language Models (LLMs) using
    > different mechanisms like direct string/registry for Google Cloud
    > models or wrapper classes for broader compatibility.

-   Optimized for the Google Cloud ecosystem, enabling seamless
    > integration with services like Vertex AI, pre-built connectors to
    > enterprise systems (e.g., BigQuery, Apigee), and the use of tools
    > for agent capabilities.

-   Facilitates agent-to-agent (A2A) communication through a
    > standardized protocol, allowing agents to discover each other and
    > delegate tasks.

# Build Overview

ADK is a high-level framework for building complex agent systems, the
Live API is a low-level feature for real-time, multimodal interaction,
and the Gen AI SDK is the foundational library that powers the
interaction with the underlying models. ADK leverages the Gen AI SDK to
connect to models, and the Live API can be used through the Gen AI SDK
to enable advanced real-time capabilities, which are then integrated
into agents built with ADK.

## Structure

-   app (POC asynchronous web app built with ADK Streaming and FastAPI)

    -   .env

    -   main.py

    -   requirements.txt

    -   static

        -   Javascript file folders (app.js)

        -   Index.html: web interface

    -   google_search_agent

        -   \_\_init\_\_.py

        -   agent.py

    -   csagent - agent connected to our support site via data store
        > with rudimentary prompting

## Instructions

1.  Connect to Google CLI & authenticate

2.  Add in project information and update other variables in dotenv

3.  Navigate to app folder

4.  Start server:

    a.  Start fast api: python -m uvicorn main:app \--host 127.0.0.1
        > \--port 8000 \--reload then go to
        > [[http://127.0.0.1:8000]{.underline}](http://127.0.0.1:8000)

    b.  OR adk web

# Resources

-   [[https://github.com/heiko-hotz/gemini-multimodal-live-dev-guide]{.underline}](https://github.com/heiko-hotz/gemini-multimodal-live-dev-guide)

-   [[https://cloud.google.com/vertex-ai/generative-ai/docs/agent-development-kit/quickstart]{.underline}](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-development-kit/quickstart)

-   [[https://github.com/google/adk-docs]{.underline}](https://github.com/google/adk-docs)

-   [[https://github.com/google/adk-python]{.underline}](https://github.com/google/adk-python)

-   [[https://google.github.io/adk-docs/]{.underline}](https://google.github.io/adk-docs/)

-   [[https://github.com/google/adk-samples]{.underline}](https://github.com/google/adk-samples)

-   [[https://medium.com/google-cloud/google-adk-vertex-ai-live-api-125238982d5e]{.underline}](https://medium.com/google-cloud/google-adk-vertex-ai-live-api-125238982d5e)
