import type { Company } from '../lib/types';

const COMPANIES_API_URL = import.meta.env.VITE_COMPANIES_API_URL;

// Raw shape returned by DynamoDB — includes internal PK/SK fields
interface RawCompany extends Company {
  PK: string;
  SK: string;
}

// Strip DynamoDB internal fields before using in the UI
function normalizeCompany(raw: RawCompany): Company {
  return {
    companyId: raw.companyId,
    name: raw.name,
    domain: raw.domain,
    tierId: raw.tierId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

// GET all companies — API returns a plain array
export async function getCompanies(): Promise<Company[]> {
  try {
    const response = await fetch(COMPANIES_API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data: RawCompany[] = await response.json();  // ✅ plain array, not { companies: [] }
    return data.map(normalizeCompany);
  } catch (error) {
    console.error('Failed to fetch companies:', error);
    throw error;
  }
}

// GET companies bypassing cache
export async function getCompaniesFresh(): Promise<Company[]> {
  try {
    const response = await fetch(`${COMPANIES_API_URL}?cb=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data: RawCompany[] = await response.json();
    return data.map(normalizeCompany);
  } catch (error) {
    console.error('Failed to fetch fresh companies:', error);
    throw error;
  }
}

// POST create new company — backend generates UUID, do not send companyId
export async function createCompany(companyData: Omit<Company, 'createdAt' | 'updatedAt'>): Promise<Company> {
  try {
    const response = await fetch(COMPANIES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: companyData.name,       // ✅ no companyId — backend generates UUID
        domain: companyData.domain,
        tierId: companyData.tierId
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    const raw: RawCompany = await response.json();
    return normalizeCompany(raw);
  } catch (error) {
    console.error('Failed to create company:', error);
    throw error;
  }
}

// PUT update existing company
export async function updateCompany(companyId: string, companyData: Partial<Company>): Promise<Company> {
  try {
    const response = await fetch(`${COMPANIES_API_URL}/${companyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: companyData.name,
        domain: companyData.domain,
        tierId: companyData.tierId
      })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    const raw: RawCompany = await response.json();
    return normalizeCompany(raw);
  } catch (error) {
    console.error('Failed to update company:', error);
    throw error;
  }
}

// DELETE company
export async function deleteCompany(companyId: string): Promise<void> {
  try {
    const response = await fetch(`${COMPANIES_API_URL}/${companyId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to delete company:', error);
    throw error;
  }
}