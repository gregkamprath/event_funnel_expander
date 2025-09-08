import { updateEventAutoExpanded } from './rails.js';
import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

const BASE_URL = process.env.BASE_URL;


(async () => {
    console.log("Yup");
    await updateEventAutoExpanded("16984", true);
    console.log("Great");
}) ();