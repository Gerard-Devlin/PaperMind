import hashlib
import json
from os import environ
import sys
from pymongo import UpdateOne
from pymongo.mongo_client import MongoClient
from meilisearch import Client as MeiliSearchClient
from tqdm import tqdm


# all secrets are stored in the environment variables
db_username = environ.get("DATABASE_USERNAME")
db_password = environ.get("DATABASE_PASSWORD")
db_host = environ.get("DATABASE_URL")
meilisearch_host = environ.get("MEILISEARCH_URL")


def update_db(json_file_path: str):
    print(f"> Updating database with {json_file_path}...")

    with open(json_file_path, "r") as json_file:
        objects = json.load(json_file)["collection"]

    print(f"> Found {len(objects)} objects in the file.")

    print(f"> Connecting to the database...")
    uri = f"mongodb://{db_username}:{db_password}@{db_host}/Metadata?authSource=admin&retryWrites=true&w=majority"
    client = MongoClient(uri)

    db = client["LocalData"]
    collection = db["Metadata"]
    count = collection.count_documents({})
    print(f"Total documents in the collection: {count}")

    meili_search_client = MeiliSearchClient(f"http://{meilisearch_host}")
    # delete index if exists
    meili_search_client.create_index("LocalData-Metadata", {"primaryKey": "_id"})
    index = meili_search_client.index("LocalData-Metadata")
    index.update_filterable_attributes(["source"])

    source = f"GITHUB-COMMUNITY"
    print(f"> Updating the database from {source}...")

    buffer = []
    for obj in tqdm(objects):
        metadata = {}

        for key, value in obj.items():
            metadata[key] = value
        metadata["authors"] = ", ".join(
            f"{author['first_name']} {author['last_name']}" for author in metadata["authors"]
        )

        metadata["_id"] = hashlib.md5(
            f"{metadata['title']}_{metadata['authors']}_{metadata['publication']}_{metadata['pubTime']}".encode()
        ).hexdigest()
        metadata["source"] = source

        buffer.append(metadata)

    collection.bulk_write(
        [
            UpdateOne(
                {"_id": metadata["_id"]},
                {"$set": metadata},
                upsert=True,
            )
            for metadata in buffer
        ]
    )


    print(f"> Indexing {len(buffer)} documents to MeiliSearch...")
    meili_buffer = []
    for result in buffer:
        doc = {"id": str(result["_id"]), "title": result["title"], "source": source}
        meili_buffer.append(doc)

    index.update_documents(meili_buffer)

    print("> Done!")


if __name__ == "__main__":
    json_file_path = sys.argv[1]

    update_db(json_file_path)
