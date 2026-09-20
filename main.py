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

import datetime

from pydantic import BaseModel

load_dotenv()

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
def list_messages(service, n=5):
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
        # print(content)
        # print(headers.get("From"), "|", headers.get("Subject"))
    return message_context, short_message

def labels(service):
    all_labels = service.users().labels().list(userId="me").execute()
    only_user_labels = [label for label in all_labels["labels"] if label["type"] == "user"]
    return only_user_labels

def chunk_list(items, chunk_size=15):
    """Yield successive chunks of size chunk_size."""
    for i in range(0, len(items), chunk_size):
        yield items[i : i + chunk_size]

def communicate_ai(labels, content):
    print("This is from ai comm channel")
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
    all_results = []

    # Process in batches of 15
    for batch in chunk_list(content, chunk_size=15):
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
    print(all_results)
    return all_results

def attach_labels(labels, content, service):
    if(not labels):
        return {"message" : "The lables list is empty"}
    if(not content):
        return {"message" : "The content list is empty"}
    # results = communicate_ai(labels, content)
    with open("another_response.json", "r") as f:
        response = json.load(f)
    for result in response:
        msg_id = result["message_id"]
        label_id = result["label_id"]

        try:
            body = {
                "addLabelIds": [label_id],
            }

            service.users().messages().modify(
                userId="me", id=msg_id, body=body
            ).execute()

            print(f"Applied {label_id} to message {msg_id}")

        except HttpError as error:
            print(f"Failed to label message {msg_id}: {error}")
    

if __name__ == "__main__":
    service = build("gmail", "v1", credentials=get_credentials())
    # send_mail(service, "nikhilbabu829@gmail.com", "Hello", "sent using the api")
    # messages, short_messages = list_messages(service)
    # user_labels = labels(service=service)
    # with open("data.json", "w") as f:
    #     json.dump(short_messages, f, indent=4)
    with open("data.json", "r") as f:
        short_messages = json.load(f)
    with open("labels.json", "r") as f:
        user_labels = json.load(f)
    results = attach_labels(user_labels, short_messages, service)
