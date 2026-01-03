/**
 * Vector Search Library for MIRA
 * Provides semantic search capabilities using MongoDB Atlas Vector Search
 */

import { getDatabase } from './mongodbNative.js';
import OpenAI from 'openai';

// Initialize OpenAI lazily to avoid build-time errors
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (apiKey) {
      openai = new OpenAI({ apiKey });
    }
  }
  return openai;
}

// Vector search index name (must match MongoDB Atlas index name)
const VECTOR_INDEX_NAME = 'vector_index';

/**
 * Generate embedding for a query
 */
export async function generateQueryEmbedding(query) {
  try {
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not configured');
    }
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating query embedding:', error);
    throw error;
  }
}

/**
 * Perform vector search on a collection
 */
export async function vectorSearch({
  collectionName,
  query,
  limit = 10,
  filters = {},
  numCandidates = 100,
}) {
  try {
    const db = await getDatabase();
    const collection = db.collection(collectionName);

    // Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(query);

    // Build the aggregation pipeline
    const pipeline = [
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: numCandidates,
          limit: limit,
          filter: buildFilters(filters),
        },
      },
      {
        $project: {
          _id: 1,
          score: { $meta: 'vectorSearchScore' },
          // Include all fields from the document
          document: '$$ROOT',
        },
      },
    ];

    const results = await collection.aggregate(pipeline).toArray();

    return results.map(result => ({
      ...result.document,
      _searchScore: result.score,
    }));
  } catch (error) {
    console.error('Vector search error:', error);
    throw error;
  }
}

/**
 * Build MongoDB filters from simple object
 */
function buildFilters(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return {};
  }

  const mongoFilters = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      mongoFilters[`metadata.${key}`] = value;
    }
  }

  return mongoFilters;
}

/**
 * Search across multiple collections
 */
export async function multiCollectionSearch({
  query,
  collections = ['employees', 'announcements', 'assets', 'departments'],
  limit = 5,
  filters = {},
}) {
  try {
    const results = await Promise.all(
      collections.map(async (collectionName) => {
        const collectionResults = await vectorSearch({
          collectionName,
          query,
          limit,
          filters,
        });

        return {
          collection: collectionName,
          results: collectionResults,
        };
      })
    );

    // Flatten and sort by score
    const allResults = results
      .flatMap(({ collection, results }) =>
        results.map(result => ({
          ...result,
          _collection: collection,
        }))
      )
      .sort((a, b) => b._searchScore - a._searchScore)
      .slice(0, limit * 2); // Return top results across all collections

    return allResults;
  } catch (error) {
    console.error('Multi-collection search error:', error);
    throw error;
  }
}

/**
 * Semantic search for employees
 */
export async function searchEmployees(query, filters = {}) {
  return vectorSearch({
    collectionName: 'employees',
    query,
    limit: 10,
    filters,
  });
}

/**
 * Semantic search for announcements
 */
export async function searchAnnouncements(query, filters = {}) {
  return vectorSearch({
    collectionName: 'announcements',
    query,
    limit: 10,
    filters,
  });
}

/**
 * Semantic search for assets
 */
export async function searchAssets(query, filters = {}) {
  return vectorSearch({
    collectionName: 'assets',
    query,
    limit: 10,
    filters,
  });
}

/**
 * Semantic search for meetings
 */
export async function searchMeetings(query, filters = {}) {
  return vectorSearch({
    collectionName: 'companymeetings',
    query,
    limit: 10,
    filters,
  });
}

/**
 * Semantic search for goals
 */
export async function searchGoals(query, filters = {}) {
  return vectorSearch({
    collectionName: 'dailygoals',
    query,
    limit: 10,
    filters,
  });
}

