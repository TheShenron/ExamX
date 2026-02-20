// api/client.ts
import axios from 'axios';
import { getToken } from '../extensionContext';
import { stopTimerBar } from '../timerBar';
import { setState } from '../state';

export const api = axios.create({
    baseURL: process.env.BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    },
    timeout: 15000,
});

api.interceptors.request.use(async (config) => {
    const token = getToken();
    config.headers.Authorization = `Bearer ${token}`;

    if (config.url === '/auth/exam' && config.method === 'post') {
        config.headers['Content-Type'] = 'application/form-data';
    }

    return config;
});

// Return type annotations can be added as needed

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            stopTimerBar();
            await setState("loggedOut");
        }
        throw error;
    }
);
