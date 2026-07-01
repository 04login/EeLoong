CREATE TABLE IF NOT EXISTS monitored_searches (
    search_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    collection_id TEXT DEFAULT NULL,
    min_price REAL DEFAULT 1,
    max_price REAL DEFAULT NULL,
    sort TEXT DEFAULT 'recent',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exclude_bumped BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS listings (
    listing_id TEXT PRIMARY KEY,
    search_id INTEGER REFERENCES monitored_searches(search_id) ON DELETE CASCADE,
    title TEXT,
    description TEXT,
    price_sgd REAL,
    seller TEXT,
    url TEXT,
    listed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS listing_analysis (
    analysis_id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT UNIQUE REFERENCES listings(listing_id) ON DELETE CASCADE,
    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    components TEXT,
    total_intrinsic_value REAL,
    deal_score REAL,
    llm_reasoning TEXT
);

