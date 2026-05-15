# Paperlib Community Metadata Collections

This repository contains community metadata collections for [Paperlib](https://github.com/Future-Scholars/paperlib).

## Contributing

To contribute, please fork this repository and add your metadata collection to the `collections` directory. Then, submit a pull request to this repository.

### Metadata Collection Format

```json5
{
    "info": {
        "name": "Name of the Conference or Journal",
        "short_name": "Short Name",
        "date": "The year"
    },
    "collection": [
        {
            "title": "Paper's Title",
            "authors": [
                {
                    "first_name": "First Name",
                    "last_name": "Last Name"
                }
            ],
            "publication": "Publication, usually the name of a conference or journal",
            "pubTime": "Publication Time, e.g., 2023",
            "pubType": 0,                // 0: journal; 1: conference; 2: others; 3: book
            "doi": "DOI",                // optional
            "arxiv": "arXiv ID",         // optional
            "pages": "Pages",            // optional
            "volume": "Volume",          // optional
            "number": "Number",          // optional
            "publisher": "Publisher"     // optional
        },
        ...
    ]
}
```

### Format

Please make sure your metadata collection is in JSON format. And format it before submitting a pull request.

You can use the following script to format your JSON file:

```bash
npm install  // pnpm install
npm run format:metadata-json  // pnpm run format:metadata-json
```

### Update Database

Once your pull request is merged, the metadata database will be updated automatically by a GitHub Action.


## Copyright

```
This repository is dedicated to storing metadata related to the publication metadata of academic papers. Please note that the copyright of the papers and all related information belongs to the original authors. The contents provided in this repository must not be used for any commercial purposes.

We respect and uphold the rights of the original authors, including copyright and other intellectual property rights. The contents within this repository must not be used in any way that infringes upon these rights. If the original authors or copyright holders have any objections to the content shared in this repository, please contact us, and we will take appropriate action immediately.
```
