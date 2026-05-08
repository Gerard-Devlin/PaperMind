import mongoose from "mongoose";
import { distance } from "fastest-levenshtein";
import * as cliProgress from "cli-progress";

export const MetadataModelSchema = new mongoose.Schema({
  title: String,
  authors: String,
  publication: String,
  pubTime: String,
  pubType: Number,
  doi: { type: String, required: false },
  arxiv: { type: String, required: false },
  pages: { type: String, required: false },
  volume: { type: String, required: false },
  number: { type: String, required: false },
  publisher: { type: String, required: false },
  source: String,
});

export async function updateDatabase(
  metadataCollection,
  source,
  databaseURL,
  databaseUsername,
  databasePassword
) {
  const db = await mongoose.connect(
    `mongodb://${databaseUsername}:${databasePassword}@${databaseURL}`
  );
  const metadataModel = db.model("Metadata", MetadataModelSchema, "Metadata");

  let [insertCount, replaceCount, ignoreCount] = [0, 0, 0];

  // 1. Delete all data of the same source
  const { deletedCount } = await metadataModel.deleteMany({
    source: source,
  });

  replaceCount += deletedCount;

  const insertItems = [];
  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  bar.start(metadataCollection.length, 0);
  for (const item of metadataCollection) {
    bar.increment();
    // 1. Find if the item already exists in the database
    const query = [];
    if (item.minifiedtitle) {
      query.push({ minifiedtitle: item.minifiedtitle });
    }
    if (item.arxiv) {
      query.push({ arxiv: item.arxiv });
    }
    if (item.doi) {
      query.push({ doi: item.doi });
    }

    if (query.length === 0) {
      throw new Error(
        `Item ${JSON.stringify(item, null, 2)} does not have any unique identifier.`
      );
    }

    const existingItems = await metadataModel.find({ $or: query });
    // 2. Handle conflicting items
    const keptItems = [];
    for (const existingItem of existingItems) {
      // Make sure it is really a conflict by checking authors
      const simScore =
        1 -
        distance(existingItem.authors, item.authors) /
          Math.max(existingItem.authors.length, item.authors.length);

      if (simScore < 0.95) {
        continue;
      }

      if (existingItem.permission === 1) {
        // Delete if it is a cache
        await metadataModel.deleteOne({ _id: existingItem._id });
        replaceCount++;
      } else {
        // Cannot overwrite if it is an item created by official or other community members
        keptItems.push(existingItem);
        ignoreCount++;
      }
    }

    // 3. Insert the item
    if (keptItems.length === 0) {
      insertItems.push(item);
      insertCount++;
    }
  }
  bar.stop();

  // 4. Insert the items
  await metadataModel.insertMany(insertItems);

  return [insertCount, replaceCount, ignoreCount];
}
