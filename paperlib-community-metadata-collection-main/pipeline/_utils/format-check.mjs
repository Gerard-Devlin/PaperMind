function checkRequiredFields(object, requiredFields) {
  for (const field of requiredFields) {
    if (
      object[field.name] === null ||
      typeof object[field.name] === "undefined"
    ) {
      throw new Error(
        `Missing ${field.name} field: ${JSON.stringify(object, null, 2).slice(0, 200)}`
      );
    } else if (field.type === "array" && !Array.isArray(object[field.name])) {
      throw new Error(
        `Incorrect type for ${field.name} field, expect ${field.type}, got ${typeof object[field.name]}: ${JSON.stringify(object, null, 2).slice(0, 200)}`
      );
    } else if (
      field.type !== "array" &&
      typeof object[field.name] !== field.type
    ) {
      throw new Error(
        `Incorrect type for ${field.name} field, expect ${field.type}, got ${typeof object[field.name]}: ${JSON.stringify(object, null, 2).slice(0, 200)}`
      );
    }
  }
}

function checkOptionalFields(object, optionalFields) {
  for (const field of optionalFields) {
    if (
      object[field.name] !== null &&
      typeof object[field.name] !== "undefined" &&
      typeof object[field.name] !== field.type
    ) {
      throw new Error(
        `Incorrect type for ${field.name} field, expect ${field.type}, got ${typeof object[field.name]}: ${JSON.stringify(object, null, 2).slice(0, 200)}`
      );
    }
  }
}

function checkIfArXivValid(arxiv) {
  const regex = /.*(\d{4}\.\d{4,5}).*/;
  return regex.test(arxiv);
}

function checkIfDOIValid(doi) {
  const regex = /^10.\d{4,9}\/[-._;()/:a-zA-Z0-9]+$/i;
  const additionalRegex = /^10.1002\/[^\s]+$/i;
  return regex.test(doi) || additionalRegex.test(doi);
}

export function formatCheck(object) {
  checkRequiredFields(object, [
    { name: "info", type: "object" },
    { name: "collection", type: "array" },
  ]);
  checkRequiredFields(object.info, [
    { name: "name", type: "string" },
    { name: "short_name", type: "string" },
    { name: "date", type: "string" },
  ]);

  for (const item of object.collection) {
    if (!item) {
      throw new Error("Collection item cannot be null/undefined.");
    }

    checkRequiredFields(item, [
      { name: "title", type: "string" },
      { name: "authors", type: "array" },
      { name: "publication", type: "string" },
      { name: "pubTime", type: "string" },
      { name: "pubType", type: "number" },
    ]);

    item.authors.forEach((author) => {
      checkRequiredFields(author, [
        { name: "first_name", type: "string" },
        { name: "last_name", type: "string" },
      ]);
    });

    checkOptionalFields(item, [
      { name: "doi", type: "string" },
      { name: "arxiv", type: "string" },
      { name: "pages", type: "string" },
      { name: "volume", type: "string" },
      { name: "number", type: "string" },
      { name: "publisher", type: "string" },
    ]);

    if (item.doi && !checkIfDOIValid(item.doi)) {
      throw new Error(
        `Incorrect DOI format for ${item.name}: ${JSON.stringify(
          object,
          null,
          2
        )}`
      );
    }

    if (item.arxiv && !checkIfArXivValid(item.arxiv)) {
      throw new Error(
        `Incorrect arXiv format for ${item.name}: ${JSON.stringify(
          object,
          null,
          2
        )}`
      );
    }
  }
}
