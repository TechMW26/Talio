/**
 * Search Library for MIRA
 * Provides provider-free collection search using MongoDB queries.
 */

import { getDatabase } from './mongodbNative.js';

const SEARCH_FIELDS = {
    default: ['name', 'title', 'description'],
    employees: ['firstName', 'lastName', 'email', 'employeeCode', 'designation', 'jobTitle'],
    announcements: ['title', 'content', 'description'],
    assets: ['assetName', 'name', 'description', 'category', 'serialNumber', 'brand'],
    departments: ['name', 'description'],
    companymeetings: ['title', 'agenda', 'description', 'meetingNotes'],
    dailygoals: ['title', 'description', 'category'],
};

function tokenizeQuery(query) {
    return String(query || '')
        .toLowerCase()
        .split(/\s+/)
        .map(term => term.trim())
        .filter(Boolean);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSearchFields(collectionName) {
    return SEARCH_FIELDS[collectionName] || SEARCH_FIELDS.default;
}

function getFieldValue(document, fieldPath) {
    return fieldPath.split('.').reduce((value, key) => value?.[key], document);
}

function buildSearchClauses(collectionName, queryTerms) {
    const fields = getSearchFields(collectionName);

    return queryTerms.flatMap(term => {
        const regex = { $regex: escapeRegex(term), $options: 'i' };
        return fields.map(field => ({ [field]: regex }));
    });
}

function scoreDocument(document, collectionName, queryTerms) {
    const haystack = getSearchFields(collectionName)
        .map(field => getFieldValue(document, field))
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

/**
 * Generate normalized query terms for internal ranking.
 */
export async function generateQueryEmbedding(query) {
    return tokenizeQuery(query);
}

/**
 * Perform provider-free search on a collection.
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
        const queryTerms = await generateQueryEmbedding(query);
        const mongoFilters = buildFilters(filters);
        const searchClauses = buildSearchClauses(collectionName, queryTerms);
        const fetchLimit = Math.max(limit, Math.min(numCandidates, limit * 5));

        const findQuery = {
            ...mongoFilters,
            ...(searchClauses.length > 0 ? { $or: searchClauses } : {}),
        };

        const results = await collection.find(findQuery).limit(fetchLimit).toArray();

        return results
            .map(result => ({
                ...result,
                _searchScore: scoreDocument(result, collectionName, queryTerms),
            }))
            .sort((a, b) => b._searchScore - a._searchScore)
            .slice(0, limit);
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

        return results
            .flatMap(({ collection, results }) =>
                results.map(result => ({
                    ...result,
                    _collection: collection,
                }))
            )
            .sort((a, b) => b._searchScore - a._searchScore)
            .slice(0, limit * 2);
    } catch (error) {
        console.error('Multi-collection search error:', error);
        throw error;
    }
}

export async function searchEmployees(query, filters = {}) {
    return vectorSearch({
        collectionName: 'employees',
        query,
        limit: 10,
        filters,
    });
}

export async function searchAnnouncements(query, filters = {}) {
    return vectorSearch({
        collectionName: 'announcements',
        query,
        limit: 10,
        filters,
    });
}

export async function searchAssets(query, filters = {}) {
    return vectorSearch({
        collectionName: 'assets',
        query,
        limit: 10,
        filters,
    });
}

export async function searchMeetings(query, filters = {}) {
    return vectorSearch({
        collectionName: 'companymeetings',
        query,
        limit: 10,
        filters,
    });
}

export async function searchGoals(query, filters = {}) {
    return vectorSearch({
        collectionName: 'dailygoals',
        query,
        limit: 10,
        filters,
    });
}
