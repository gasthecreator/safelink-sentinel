// app/constants/endpoints.js

const BASE_URL = "http://localhost:4000"; // local microservice

const ENDPOINTS = {
  HEALTH: `${BASE_URL}/health`,
  SYNC: `${BASE_URL}/sync`,
  MESSAGES: `${BASE_URL}/messages`,
  PEERS: `${BASE_URL}/peers`,
  LOGS: `${BASE_URL}/logs`,
  RESCUES: `${BASE_URL}/api/rescues`,
  RESCUE_STATS: `${BASE_URL}/api/rescues/stats`,
};

export default ENDPOINTS;

