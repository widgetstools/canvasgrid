import './agGridSetup';
import './styles.css';
import { mountPositionsGrid } from './grid/positionsGrid';
import { DEFAULT_STOMP_CONFIG } from './types';

mountPositionsGrid(document.getElementById('root')!, DEFAULT_STOMP_CONFIG);
