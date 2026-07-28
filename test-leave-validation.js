import mongoose from 'mongoose';
import Leave from './models/Leave.js';
console.log(Leave.schema.path('leaveType').isRequired);
