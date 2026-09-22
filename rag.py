import chromadb
from chromadb.utils import embedding_functions
from sentence_transformers import SentenceTransformer
import json

from anthropic import Anthropic

embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction("BAAI/bge-base-en-v1.5")

chroma_client = chromadb.PersistentClient(path="./chroma_db")

collection = chroma_client.get_or_create_collection(
    name="emails",
    embedding_function=embedding_function,
    metadata={"hnsw:space": "cosine"}
)

client = Anthropic()

def index_emails():

    with open("long_content.json", "r") as f:
        messages =  json.load(f)

    ids = []
    documents = []
    metadatas = []

    for msg in messages:
        msg_id = msg.get("message_id", "")
        subject = msg.get("subject") or "No Subject"
        sender = msg.get("sender") or "Unknown"
        snippet = msg.get("snippet") or msg.get("sinppet", "")
        content = msg.get("content") or snippet

        doc_text = f"Subject: {subject}\nFrom: {sender}\n\n{content}"

        ids.append(msg_id)
        documents.append(doc_text)
        metadatas.append({
            "message_id": msg_id,
            "sender": sender,
            "subject": subject,
            "summary": snippet[:200]
        })

    collection.upsert(
        ids=ids,
        documents=documents,
        metadatas=metadatas
    )
    return len(ids)

def query_rag(query: str, n_results: int = 4):
    index_emails()
    results = collection.query(
        query_texts=[query],
        n_results=n_results
    )

    retrieved_docs = results["documents"][0] if results["documents"] else []
    retrieved_metas = results["metadatas"][0] if results["metadatas"] else []

    if not retrieved_docs:
        return {
            "answer": "No relevant emails were found to answer your question.",
            "sources": []
        }

    context_blocks = []
    sources = []
    for doc, meta in zip(retrieved_docs, retrieved_metas):
        context_blocks.append(
            f"---\nMessage ID: {meta['message_id']}\nSender: {meta['sender']}\n{doc}\n---"
        )
        sources.append({
            "message_id": meta["message_id"],
            "sender": meta["sender"],
            "summary": meta["summary"]
        })

    context_str = "\n\n".join(context_blocks)

    # 3. Augment and Generate with Claude
    prompt = f"""You are an assistant answering questions about the user's emails.
Use the following retrieved emails as context to answer the question.
If the answer is not found in the context, say that you don't know based on the recent emails.

Context:
{context_str}

User Question: {query}"""

    with client.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for text in stream.text_stream:
            # Send each partial text chunk
            yield f"event: token\ndata: {json.dumps(text)}\n\n"

    # Signal completion
    yield "event: done\ndata: {}\n\n"
