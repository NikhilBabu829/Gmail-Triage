#TODO - add multimodal capabilities, where the uesr can ask question using voice, and also get the response back in actual voice

import os
import base64
from email.message import EmailMessage

from rich import print
from rich.json import JSON
from rich.console import Console

from anthropic import Anthropic

from dotenv import load_dotenv  

import json
import re

from email import message_from_bytes
from email import policy

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from pydantic import BaseModel

from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional

from rag import query_rag

app = FastAPI()

load_dotenv()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


con = Console()

client = Anthropic()

class SendMail(BaseModel):
    to : str
    subject : str
    body : str

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]

def get_credentials():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as f:
            f.write(creds.to_json())
    return creds

def send_mail(service, to, subject, body):
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return service.users().messages().send(userId="me", body={"raw": raw}).execute()

#this function takes a service, gives out an array that has each message with msg_id, thread_id, sender, subject and body of the message
def list_messages(service):
    con.log("Inside of getting the messages")
    result = service.users().messages().list(userId="me",q="newer_than:1d").execute()
    message_context = []
    short_message = []
    for m in result.get("messages", []):
        msg = service.users().messages().get(
            userId="me", id=m["id"], format="raw",
        ).execute()
        snippet = msg["snippet"]
        raw_message = msg["raw"]
        message_id = msg["id"]
        thread_id = msg["threadId"]
        decoded_content = base64.urlsafe_b64decode(raw_message)
        message = message_from_bytes(decoded_content, policy=policy.default)
        subject = message["subject"]
        sender = message["from"]
        for content_type in message.walk():
            if(content_type.get_content_maintype() != "multipart"):
                message_body = content_type.get_content()
                break
        message_context.append(
            {
                "message_id" : message_id,
                "thread_id" : thread_id,
                "sender" : sender,
                "sinppet" : snippet,
                "subject" : subject,
                "content" : message_body
            }
        )
        short_message.append({
            "message_id" : message_id,
            "thread_id" : thread_id,
            "sender" : sender,
            "subject" : subject,
            "sinppet" : snippet,
        })
    con.log("Got all the short and long content, \n returning them to the original function")
    con.log("Writing both the short and long content to .json file")
    with open("short.json", "w") as f:
        json.dump(short_message, f, indent=4)
    with open("long_content.json", "w") as f:
            json.dump(message_context, f, indent=4)
        # print(content)
        # print(headers.get("From"), "|", headers.get("Subject"))
    return message_context

def labels(service):
    con.log("We are now going to retrieve the custom labels")
    all_labels = service.users().labels().list(userId="me").execute()
    
    # Filter for user labels, ignoring IMAP system artifacts
    only_user_labels = [
        label for label in all_labels.get("labels", [])
        if label.get("type") == "user" and not label.get("name", "").startswith("[Imap]")
    ]

    con.log("Retrieved labels")
    con.log("Writing Custom labels to a file")
    with open("custom_lables.json", "w") as f:
        json.dump(only_user_labels, f, indent=4)
    return only_user_labels

def chunk_list(items, chunk_size=15):
    """Yield successive chunks of size chunk_size."""
    for i in range(0, len(items), chunk_size):
        yield items[i : i + chunk_size]

def call_ai(system_prompt, lables = None, content = None):
    con.log("Calling the ai")
    all_results = []
    # Process in batches of 15
    target_list = lables if lables is not None else (content or [])
    print(target_list)
    for batch in chunk_list(target_list, chunk_size=15):
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2048,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"Triage these emails:\n{json.dumps(batch)}",
                }
            ],
        )
        if response.stop_reason == "max_tokens":
            print("Warning: Batch truncated! Try reducing chunk_size.")

        clean_json = re.sub(
            r"^```(?:json)?\s*|\s*```$", "", response.content[0].text.strip()
        )
        batch_results = json.loads(clean_json)
        all_results.extend(batch_results)
    con.log("The results are in!, returning to the function")
    return all_results

def communicate_ai(labels, content):
    con.log("This is from ai comms channel")
    formatted_labels = "\n".join(
        f"- {label.get('id', label)}: {label.get('name', '')}"
        if isinstance(label, dict)
        else f"- {label}"
        for label in labels
    )
    system_prompt = f"""You are an email triage engine. Evaluate each email and assign the single best label ID from the allowed taxonomy.

<taxonomy>
{formatted_labels}
</taxonomy>

Output ONLY a raw, valid JSON array of objects. Do not include markdown fences, backticks, or preamble.
JSON Array Schema:
[
  {{
    "message_id": "string",
    "thread_id": "string",
    "label_id": "string",
    "confidence": 0.95,
    "sender": "string"
  }}
]"""
    con.log("sending args to the call_ai")
    results = call_ai(system_prompt=system_prompt, content=content)
    con.log("retrieved results from ai, \n now returning them")
    return results

def attach_labels(labels, content, service):
    con.log("We are now trying to attach custom lables to the mails")
    if(not labels):
        return {"message" : "The lables list is empty"}
    if(not content):
        return {"message" : "The content list is empty"}
    con.log("contacting the comm channel to get the appropriate tags")
    results = communicate_ai(labels, content)
    con.log("Recived the tags")
    con.log("Now starting to apply the tags to respective emails")
    for result in results:
        msg_id = result["message_id"]
        label_id = result["label_id"]
        try:
            body = {
                # "addLabelIds": [label_id],
                "removeLabelIds": [label_id],
            }

            service.users().messages().modify(
                userId="me", id=msg_id, body=body
            ).execute()

            print(f"Applied {label_id} to message {msg_id}")

        except HttpError as error:
            print(f"Failed to label message {msg_id}: {error}")

def generate_summary(content = ""):
    con.log("trying to generate the summary for different emails")
    if(not content):
        return {"message" : "The content list is empty"}

    system_prompt="""
You are an expert executive assistant specializing in email triage. Your task is to process incoming emails, extract key metadata, and generate concise, actionable summaries.

Output Constraints:
- Return strictly valid JSON. Do not include introductory text, explanations, or conversational filler.
- If processing a single email, return a single JSON object. If processing multiple emails, return a JSON array of objects.
- Ensure all string values are valid and properly escaped.

JSON Schema:
{
  "message_id": "<string: exact message identifier provided in input>",
  "sender": "<string: sender's name and/or email address>",
  "summary": "<string: concise, high-signal summary>"
}

Summarization Guidelines:
- Highlight primary intent, specific asks, decisions, deadlines, and required actions.
- Remove all conversational fluff, pleasantries, greetings, signatures, and legal disclaimers.
- Keep summaries strictly within 1 to 3 informative, objective sentences.
- Preserve key numbers, monetary figures, dates, times, and project names.
- For transactional or automated emails (receipts, password resets, 2FA codes), state the core action or code in one sentence.
- If message_id cannot be found in the input, set it to "unknown".
- If sender cannot be determined, set it to "Unknown Sender".
- Do not hallucinate or assume facts not present in the email text.
"""
    con.log("Sending a request to the ai to get the summary for each email")
    all_results = call_ai(system_prompt=system_prompt, content=content)
    con.log("Got the summary for each email")
    with open("summary.json", "w") as f:
        json.dump(all_results, f, indent=4)
    con.log("Sending the sumarry back to the original funciton")
    print(all_results)
    return all_results

def agent(service, max_safety_turns=10):
    tools = [
        {
            "name" : "list_messages",
            "description" : "It retrieves all the mails for the past 24hrs",
            "input_schema" : {
                "type" : "object",
                "properties" : {}
            }
        },
        {
            "name" : "labels",
            "description" : "It retrieves all the custom labels a user might have",
            "input_schema" : {
                "type" : "object",
                "properties" : {}
            }
        },
        {
            "name": "attach_labels",
            "description": (
                "Triages and attaches custom Gmail labels to a list of email messages "
                "based on the allowed labels and email contents."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "labels": {
                        "type": "array",
                        "description": "The available custom user labels to choose from.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "The unique Gmail label ID (e.g., 'Label_123')."
                                },
                                "name": {
                                    "type": "string",
                                    "description": "The human-readable label name (e.g., 'URGENT', 'Finance')."
                                }
                            },
                            "required": ["id", "name"]
                        }
                    },
                    "content": {
                        "type": "array",
                        "description": "List of emails with their metadata and body content to be triaged.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "message_id": {
                                    "type": "string",
                                    "description": "The unique Gmail message ID."
                                },
                                "thread_id": {
                                    "type": "string",
                                    "description": "The Gmail thread ID."
                                },
                                "sender": {
                                    "type": "string",
                                    "description": "Sender email and name."
                                },
                                "subject": {
                                    "type": "string",
                                    "description": "Subject of the email."
                                },
                                "snippet": {
                                    "type": "string",
                                    "description": "Short snippet/preview of the email."
                                },
                                "content": {
                                    "type": "string",
                                    "description": "Full text body of the email message."
                                }
                            },
                            "required": ["message_id", "subject"]
                        }
                    }
                },
                "required": ["labels", "content"]
            }
        },
        {
            "name" : "generate_summary",
            "description" : "It Generates summary of the entire emails for the past 24hrs",
            "input_schema" : {
                "type" : "object",
                "properties" : {}
            }
        }
    ]
    messages = [
        {
            "role": "user", 
            "content": "I need you to traige some emails, you can start by getting all the past 24 hour emails"
        }
    ]
    count = 0
    while True:
        count+=1
        if count > max_safety_turns:
            print("[Warning: Reached maximum emergency safety turns]")
            break
        with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            tools=tools,
            messages=messages,
        ) as stream:
            for event in stream:
                if event.type == "content_block_delta":
                # Streamed text tokens
                    if event.delta.type == "text_delta":
                        print(event.delta.text, end="", flush=True)
                    # Streamed JSON arguments for tool calls
                    elif event.delta.type == "input_json_delta":
                        pass  # Accumulates partial JSON arguments
            final_response = stream.get_final_message()
        messages.append({"role": "assistant", "content": final_response.content})
        if final_response.stop_reason != "tool_use":
            print("\n[Triage complete]")
            break
        tool_results = []
        if final_response.stop_reason == "tool_use":
            tool_blocks = [b for b in final_response.content if b.type == "tool_use"]
            for tool_call in tool_blocks:
                if tool_call.name == "list_messages":
                    output = list_messages(service=service)
                elif tool_call.name == "labels":
                    output = labels(service=service)
                elif tool_call.name == "attach_labels":
                    with open("long_content.json", "r") as f:
                        content = json.load(f)
                    with open("custom_lables.json", "r") as f:
                        email_labels = json.load(f)
                    output = attach_labels(email_labels, content=content, service=service)
                elif tool_call.name == "generate_summary":
                    with open("long_content.json", "r") as f:
                        content = json.load(f)
                    output = generate_summary(content=content)
                else:
                    output = {"error": f"Unknown tool: {tool_call.name}"}
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "content": json.dumps(output or {"status": "success"})
                })
            messages.append({"role": "user", "content": tool_results})

    return messages

def insertion():
    with open("long_content.json" "r") as f:
        long_content = json.load(f)
    

if __name__ == "__main__":
    service = build("gmail", "v1", credentials=get_credentials())
    # send_mail(service, "nikhilbabu829@gmail.com", "Hello", "sent using the api")
    # messages, short_messages = list_messages(service)
    # with open("short.json", "r") as f:
    #     short_messages = json.load(f)
    # with open("long_content.json", "r") as f:
    #         full_content = json.load(f)
    # user_labels = labels(service=service)
    # with open("custom_lables.json", "r") as f:
    #     custom_labels = json.load(f)
    # results = attach_labels(user_labels, short_messages, service)
    # response = generate_summary(full_content)
    answer = agent(service)
    print(answer)

@app.post("/api/triage/run")
def running_traige():
    service = build("gmail", "v1", credentials=get_credentials())
    response = agent(service=service)
    return response

@app.get("/api/triage/summary")
def get_summary():
    con.log("entered the route")
    with open("summary.json", "r") as f:
        summary = json.load(f)
    results = generate_summary(summary)
    return results

@app.post("/api/rag/multimodal-query")
def rag(
    prompt: str = Form(...),
    image: Optional[UploadFile] = File(None)
    ):
    return StreamingResponse(
        query_rag(query=prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )
