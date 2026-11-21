import os
import smtplib
from email.message import EmailMessage


def send_email(recipient: str, subject: str, body: str, attachments=None) -> None:
    """Deliver a plain-text email through the configured SMTP account.
    attachments: optional list of (filename, bytes, mime type)."""
    host = os.getenv('SMTP_HOST')
    username = os.getenv('SMTP_USERNAME')
    password = os.getenv('SMTP_PASSWORD')
    sender = os.getenv('SMTP_FROM_EMAIL') or username
    if not all((host, username, password, sender)):
        raise RuntimeError('SMTP email is not configured')

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = sender
    message['To'] = recipient
    message.set_content(body)
    for name, data, mime in attachments or []:
        main, _, sub = (mime or 'application/octet-stream').partition('/')
        message.add_attachment(data, maintype=main, subtype=sub or 'octet-stream', filename=name)
    with smtplib.SMTP(host, int(os.getenv('SMTP_PORT', '587')), timeout=15) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)
