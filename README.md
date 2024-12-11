WIP File

Connect Elevenlabs Conversation AI agent to Twilio for inbound and outbound calls. 

IMAGE placeholder

Watch the video tutorial here: LINK

Overview

This repository gives you all the javascript code you will need to conenct Twilio to your Elevenlabs AI agent for inbound and outbound calls. 

Code included:

- unauthenticated inbound calls
- authenticated inbound calls
- inbound calls with custom params

- unauthenticated outbound calls
- authenticated outbound calls
- outbound calls with custom params

And the boss mode code for 

- outbound calls with cusom params that were passed in from make.com (so you could eg have a google sheet with customer details and feed them into the agent)

Features:

- inbound calls
- outbound calls
- authenticated requests
- custom variables
- pass custom variables through make.com

Passing Through custom Parameters

You need to use authenticated requests in order to pass custom variables into the agent.

Make sure to follow these settings to configure your AI agent (from within Elevenlabs) to (1) work with Twilio and (2) be able to use authenticated requests.

Settings for Twilio: https://elevenlabs.io/docs/conversational-ai/guides/conversational-ai-twilio

Settings for authenticated requests: https://elevenlabs.io/docs/conversational-ai/customization/conversation-configuration
Note: Make sure to also turn on "Enable authentication"

System Architecture

![CleanShot 2024-12-11 at 13 02 52](https://github.com/user-attachments/assets/30d38b95-a56b-419f-ad37-5e1fef0cab6a)

Passing in custom values from make.com

![CleanShot 2024-12-11 at 13 05 36](https://github.com/user-attachments/assets/382c95b5-4417-42e1-82ae-0ea8488d5878)

Authenitcated vs Unauthenticated workflow

![CleanShot 2024-12-11 at 13 21 50](https://github.com/user-attachments/assets/089bfaf2-5441-4ee0-8b11-a16a00b9383f)

Note

How to set up

Create .env file

ELEVENLABS_AGENT_ID=your-elevenlabs-agent-id
ELEVENLABS_API_KEY=your-elevenlabs-api-key
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number
