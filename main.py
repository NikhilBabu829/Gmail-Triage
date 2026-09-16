import os
import base64
from email.message import EmailMessage

from rich import print

from email import message_from_bytes
from email import policy

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

import datetime

from pydantic import BaseModel

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

def get_body():
    pass

def list_messages(service, n=5):
    date = datetime.date.today()
    result = service.users().messages().list(userId="me",q=f"after:{date}").execute()
    message_context = []
    for m in result.get("messages", []):
        msg = service.users().messages().get(
            userId="me", id=m["id"], format="raw",
        ).execute()
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
        print(f"Message id is {message_id}")
        print(f"thread id is {thread_id}")
        print(f"subject is {subject}")
        print(f"sender is {sender}")
        message_context.append(
            {
                "message_id" : message_id,
                "thread_id" : thread_id,
                "sender" : sender,
                "subject" : subject,
                "body" : message_body
            }
        )
        # print(content)
        # print(headers.get("From"), "|", headers.get("Subject"))
    print(message_context)

if __name__ == "__main__":
    service = build("gmail", "v1", credentials=get_credentials())
    # send_mail(service, "nikhilbabu829@gmail.com", "Hello", "sent using the api")
    list_messages(service)
    # print(len(data))
