import axios from 'axios';

const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

const Api = axios.create({
  baseURL:
    envBaseUrl ||
    (import.meta.env.PROD ? 'https://somethingintheair.tech/api' : 'http://localhost:8010/api'),
});

export default Api;
