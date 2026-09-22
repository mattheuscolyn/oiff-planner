#!/usr/bin/env node

/**
 * OIFF 2026 Data Importer
 * 
 * Fetches the currently published Orcas Island Film Festival 2026 program
 * from the official Eventive API and normalizes it for use in the planner app.
 * 
 * Data Source:
 * - Base URL: https://api.eventive.org/
 * - Event Bucket ID: 6a0956525c02a8a06eba1d7e
 * - API Key: 8b9ce51e493e5ef573d4590dca7f6c6c (public client-side key)
 * - Authentication: HTTP Basic Auth (API key as username, no password)
 * 
 * Endpoints:
 * - Films: GET /event_buckets/{bucket_id}/films
 * - Events: GET /event_buckets/{bucket_id}/events
 * 
 * Note: This API key is publicly accessible in the client-side JavaScript
 * served at https://oifilmfest2026.eventive.org/ and is intended for
 * public read access to the festival program.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'https://api.eventive.org';
const EVENT_BUCKET_ID = '6a0956525c02a8a06eba1d7e';
const API_KEY = '8b9ce51e493e5ef573d4590dca7f6c6c';

function fetchEventive(endpoint) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${API_KEY}:`).toString('base64');
    const url = new URL(`${API_BASE}${endpoint}`);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function parseDate(dateString, timezone = 'America/Los_Angeles') {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  
  return `${year}-${month}-${day}`;
}

function parseTime(dateString, timezone = 'America/Los_Angeles') {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  return formatter.format(date);
}

function normalizeFilm(eventiveFilm) {
  const runtime = eventiveFilm.details?.runtime 
    ? parseInt(eventiveFilm.details.runtime, 10) 
    : null;
  
  const year = eventiveFilm.details?.year 
    ? parseInt(eventiveFilm.details.year, 10) 
    : null;

  return {
    id: eventiveFilm.id,
    title: eventiveFilm.name,
    year: year,
    runtime: runtime && runtime > 0 ? runtime : null,
    director: eventiveFilm.credits?.director || null,
    country: eventiveFilm.details?.country || null,
    language: eventiveFilm.details?.language || null,
    synopsis: eventiveFilm.short_description || null,
    fullDescription: eventiveFilm.description?.replace(/<[^>]*>/g, '') || null,
    poster: eventiveFilm.poster_image || null,
    coverImage: eventiveFilm.cover_image || null,
    trailerUrl: eventiveFilm.trailer_url || null,
    eventiveUrl: `https://oifilmfest2026.eventive.org/films/${eventiveFilm.id}`,
    programType: eventiveFilm.type || 'film',
    tags: eventiveFilm.tags?.map(t => t.name) || [],
    credits: eventiveFilm.credits || {},
    details: eventiveFilm.details || {},
    sourceData: {
      eventiveId: eventiveFilm.id,
      sortKey: eventiveFilm.sort_key,
      visibility: eventiveFilm.visibility
    }
  };
}

function normalizeEvent(eventiveEvent) {
  const timezone = eventiveEvent.timezone || 'America/Los_Angeles';
  const startDate = parseDate(eventiveEvent.start_time, timezone);
  const startTime = parseTime(eventiveEvent.start_time, timezone);
  const endTime = eventiveEvent.end_time ? parseTime(eventiveEvent.end_time, timezone) : null;
  
  const filmIds = eventiveEvent.films?.map(f => f.id) || [];
  
  return filmIds.map(filmId => ({
    id: `${eventiveEvent.id}_${filmId}`,
    eventId: eventiveEvent.id,
    filmId: filmId,
    date: startDate,
    startTime: startTime,
    endTime: endTime,
    venue: eventiveEvent.venue?.name?.trim() || null,
    venueId: eventiveEvent.venue?.id || null,
    eventiveUrl: `https://oifilmfest2026.eventive.org/events/${eventiveEvent.id}`,
    name: eventiveEvent.name || null,
    shortDescription: eventiveEvent.short_description || null,
    visibility: eventiveEvent.visibility,
    sourceData: {
      eventiveId: eventiveEvent.id,
      eventStart: eventiveEvent.start_time,
      eventEnd: eventiveEvent.end_time,
      timezone: eventiveEvent.timezone
    }
  }));
}

function validateData(films, screenings) {
  const errors = [];
  const warnings = [];
  
  const filmIds = new Set(films.map(f => f.id));
  const duplicateFilmIds = films.map(f => f.id).filter((id, idx, arr) => arr.indexOf(id) !== idx);
  if (duplicateFilmIds.length > 0) {
    errors.push(`Duplicate film IDs: ${duplicateFilmIds.join(', ')}`);
  }
  
  const screeningIds = new Set();
  const duplicateScreeningIds = [];
  screenings.forEach(s => {
    if (screeningIds.has(s.id)) {
      duplicateScreeningIds.push(s.id);
    }
    screeningIds.add(s.id);
  });
  if (duplicateScreeningIds.length > 0) {
    errors.push(`Duplicate screening IDs: ${duplicateScreeningIds.join(', ')}`);
  }
  
  screenings.forEach(s => {
    if (s.filmId && !filmIds.has(s.filmId)) {
      errors.push(`Screening ${s.id} references non-existent film ${s.filmId}`);
    }
    
    if (!s.date || !s.startTime) {
      errors.push(`Screening ${s.id} missing date or start time`);
    }
    
    if (!s.venue && !s.name?.includes('Virtual')) {
      warnings.push(`Screening ${s.id} has no venue`);
    }
  });
  
  films.forEach(f => {
    if (!f.title) {
      errors.push(`Film ${f.id} has no title`);
    }
    
    if (f.title && (f.title.includes('Film #') || f.title.includes('Placeholder'))) {
      errors.push(`Film ${f.id} appears to be placeholder data: ${f.title}`);
    }
    
    if (!f.runtime) {
      warnings.push(`Film ${f.id} (${f.title}) missing runtime`);
    } else if (f.runtime < 1 || f.runtime > 400) {
      warnings.push(`Film ${f.id} (${f.title}) has unusual runtime: ${f.runtime}`);
    }
    
    if (!f.poster) {
      warnings.push(`Film ${f.id} (${f.title}) missing poster`);
    } else if (f.poster.includes('/posters/')) {
      errors.push(`Film ${f.id} has placeholder poster path: ${f.poster}`);
    }
  });
  
  return { errors, warnings };
}

function generateReport(films, screenings) {
  const filmsByType = {};
  films.forEach(f => {
    const type = f.programType || 'unknown';
    filmsByType[type] = (filmsByType[type] || 0) + 1;
  });
  
  const screeningsByDate = {};
  screenings.forEach(s => {
    if (s.date) {
      screeningsByDate[s.date] = (screeningsByDate[s.date] || 0) + 1;
    }
  });
  
  const venues = [...new Set(screenings.map(s => s.venue).filter(Boolean))].sort();
  
  const filmsWithMultipleScreenings = films.filter(f => {
    const count = screenings.filter(s => s.filmId === f.id).length;
    return count > 1;
  }).length;
  
  const filmsMissingRuntime = films.filter(f => !f.runtime).length;
  const filmsMissingPoster = films.filter(f => !f.poster).length;
  const filmsMissingDirector = films.filter(f => !f.director).length;
  
  return {
    totalFilms: films.length,
    filmsByType,
    totalScreenings: screenings.length,
    screeningsByDate,
    venues,
    filmsWithMultipleScreenings,
    missingMetadata: {
      runtime: filmsMissingRuntime,
      poster: filmsMissingPoster,
      director: filmsMissingDirector
    }
  };
}

async function main() {
  console.log('OIFF 2026 Data Importer');
  console.log('=======================\n');
  
  console.log('Fetching films from Eventive API...');
  const filmsResponse = await fetchEventive(`/event_buckets/${EVENT_BUCKET_ID}/films`);
  const rawFilms = filmsResponse.films || [];
  console.log(`✓ Fetched ${rawFilms.length} films\n`);
  
  console.log('Fetching events from Eventive API...');
  const eventsResponse = await fetchEventive(`/event_buckets/${EVENT_BUCKET_ID}/events`);
  const rawEvents = eventsResponse.events || [];
  console.log(`✓ Fetched ${rawEvents.length} events\n`);
  
  console.log('Normalizing data...');
  const films = rawFilms
    .filter(f => f.visibility === 'visible')
    .map(normalizeFilm)
    .sort((a, b) => {
      const aKey = a.sourceData.sortKey || a.title;
      const bKey = b.sourceData.sortKey || b.title;
      return aKey.localeCompare(bKey);
    });
  
  const screenings = rawEvents
    .filter(e => e.visibility === 'visible' && e.films && e.films.length > 0)
    .flatMap(normalizeEvent)
    .filter(s => s.date && s.startTime)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
  
  const festivalDates = [...new Set(screenings.map(s => s.date).filter(Boolean))].sort();
  const venues = [...new Set(screenings.map(s => s.venue).filter(Boolean))].sort();
  
  console.log(`✓ Normalized ${films.length} films`);
  console.log(`✓ Normalized ${screenings.length} screenings\n`);
  
  console.log('Validating data...');
  const validation = validateData(films, screenings);
  
  if (validation.errors.length > 0) {
    console.error('\n❌ ERRORS:');
    validation.errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
  
  if (validation.warnings.length > 0) {
    console.warn('\n⚠️  WARNINGS:');
    validation.warnings.forEach(w => console.warn(`  - ${w}`));
  }
  
  console.log('\n✓ Validation passed\n');
  
  const report = generateReport(films, screenings);
  
  console.log('Import Summary');
  console.log('==============');
  console.log(`Total programs: ${report.totalFilms}`);
  console.log('\nPrograms by type:');
  Object.entries(report.filmsByType).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log(`\nTotal screenings: ${report.totalScreenings}`);
  console.log('\nScreenings by day:');
  Object.entries(report.screeningsByDate).forEach(([date, count]) => {
    console.log(`  - ${date}: ${count}`);
  });
  console.log(`\nVenues found: ${report.venues.length}`);
  report.venues.forEach(v => console.log(`  - ${v}`));
  console.log(`\nPrograms with multiple screenings: ${report.filmsWithMultipleScreenings}`);
  console.log('\nMissing metadata:');
  console.log(`  - Runtime: ${report.missingMetadata.runtime}`);
  console.log(`  - Poster: ${report.missingMetadata.poster}`);
  console.log(`  - Director: ${report.missingMetadata.director}`);
  
  const outputData = {
    films,
    screenings,
    venues: venues.map(name => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name
    })),
    festivalDates,
    _metadata: {
      importedAt: new Date().toISOString(),
      source: 'Eventive API',
      eventBucketId: EVENT_BUCKET_ID,
      apiVersion: '1'
    }
  };
  
  const outputPath = path.join(__dirname, '..', 'src', 'data', 'films.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2) + '\n');
  console.log(`\n✓ Written to ${outputPath}\n`);
  
  console.log('Import complete! 🎬');
}

main().catch(err => {
  console.error('\n❌ Import failed:', err.message);
  process.exit(1);
});
