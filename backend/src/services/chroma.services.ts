import { logger } from '../utils/logger';
import { config } from '../config';
import { IChromaService } from '../di/interfaces';


export class ChromaService implements IChromaService {
    private baseURL: any;
    // renamed internal flags to avoid duplicate identifier with public methods
    private connected: boolean = false;
    private limitedMode: boolean = false;
    private healthcareKnowledge: Map<string, string> = new Map();

    constructor(baseURL?: string) {
        this.baseURL = baseURL || config.CHROMA_SERVER_URL;
        logger.info(`ChromaService initialized with URL: ${this.baseURL}`);
        this.initializeLocalKnowledge();
    }

    private initializeLocalKnowledge(): void {
        // Local healthcare knowledge base as fallback
        this.healthcareKnowledge.set('appointment_booking',
            'You can book appointments for General Practice, Cardiology, or Pediatrics. We need your preferred date, time, and reason for visit. Appointments are typically 30 minutes. We are open Monday to Friday, 9 AM to 5 PM.');

        this.healthcareKnowledge.set('cardiology_info',
            'Dr. Michael Johnson specializes in Cardiology with 15 years of experience. He focuses on heart conditions, blood pressure management, and cardiovascular health. Cardiology appointments include comprehensive heart health assessments.');

        this.healthcareKnowledge.set('pediatrics_info',
            'Dr. Emily Williams is our Pediatrics specialist with 8 years of experience caring for children and infants. Pediatrics services include vaccinations, growth monitoring, developmental checks, and treatment of childhood illnesses.');

        this.healthcareKnowledge.set('general_practice_info',
            'Dr. Sarah Smith is our General Practitioner with 10 years of experience in family medicine. General Practice covers routine checkups, vaccinations, common illnesses, preventive care, and annual physical examinations.');

        this.healthcareKnowledge.set('insurance_info',
            'We accept most major insurance plans including Blue Cross, Aetna, Cigna, and United Healthcare. Please bring your insurance card and photo ID to your appointment. Our billing department can verify coverage before your visit.');

        this.healthcareKnowledge.set('emergency_info',
            'For urgent medical issues after hours, call our emergency line at 555-0123 or visit the nearest emergency room for immediate medical attention. Our regular hours are Monday to Friday, 9 AM to 5 PM for scheduled appointments.');

        this.healthcareKnowledge.set('prescription_info',
            'Prescription refills can be requested through our patient portal or by calling during business hours. Allow 48 hours for processing. For controlled substances, you may need an office visit for renewal.');

        this.healthcareKnowledge.set('clinic_hours',
            'Our clinic is open Monday through Friday from 9:00 AM to 5:00 PM. We are closed on weekends and major holidays. Telehealth appointments are available for follow-up visits.');

        this.healthcareKnowledge.set('new_patients',
            'New patients should arrive 15 minutes early to complete registration forms. Please bring your insurance card, photo ID, and list of current medications. Medical records from previous providers can be transferred with your authorization.');

        this.healthcareKnowledge.set('telehealth_info',
            'We offer secure telehealth appointments for follow-up visits, medication management, and non-urgent consultations. You will receive a secure video link before your scheduled appointment time.');
    }

    async initialize(): Promise<void> {
        try {
            // Test connection first
            await this.testConnection();

            // Try to check if collections API is available
            await this.checkCollectionsAPI();

            this.connected = true;
            logger.info('✅ Chroma Service initialized (limited mode)');

        } catch (error) {
            logger.warn('❌ Chroma Service initialization failed, using local knowledge base:', error);
            this.connected = false;
            this.limitedMode = true;
        }
    }

    private async testConnection(): Promise<void> {
        try {
            const response = await fetch(`${this.baseURL}/api/v2/version`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`ChromaDB connection failed: ${response.statusText}`);
            }

            const data = await response.json();
            logger.info(`🔗 Connected to ChromaDB version: ${data}`);

        } catch (error) {
            throw new Error(`Cannot connect to ChromaDB at ${this.baseURL}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async checkCollectionsAPI(): Promise<void> {
        try {
            const response = await fetch(`${this.baseURL}/api/v2/collections`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (response.status === 404 || response.status === 501) {
                logger.info('ℹ️ Chroma collections API not supported by server; using local knowledge base.');
                this.limitedMode = true;
                return;
            }

            if (!response.ok) {
                throw new Error(`Collections API check failed: ${response.statusText}`);
            }

            // If we get here, collections API is available
            logger.info('✅ Chroma collections API is available');

        } catch (error) {
            logger.warn('Chroma collections API not available, using local knowledge base');
            this.limitedMode = true;
        }
    }

    async search(query: string, nResults: number = 3): Promise<string[]> {
        if (this.limitedMode || !this.connected) {
            return this.localSearch(query, nResults);
        }

        try {
            // For now, use local search since collections API isn't available
            return this.localSearch(query, nResults);

        } catch (error) {
            logger.error('Chroma search error, using local knowledge:', error);
            return this.localSearch(query, nResults);
        }
    }

    private localSearch(query: string, nResults: number): string[] {
        const lowerQuery = query.toLowerCase();

        // Score each knowledge entry based on query relevance
        const scoredResults: Array<{ key: string; score: number; content: string; }> = [];

        this.healthcareKnowledge.forEach((content, key) => {
            let score = 0;

            // Basic keyword matching with weights
            if (lowerQuery.includes('appointment') || lowerQuery.includes('book') || lowerQuery.includes('schedule')) {
                if (key.includes('appointment')) score += 10;
                if (key.includes('clinic')) score += 5;
            }

            if (lowerQuery.includes('cardiology') || lowerQuery.includes('heart')) {
                if (key.includes('cardiology')) score += 10;
            }

            if (lowerQuery.includes('pediatric') || lowerQuery.includes('child') || lowerQuery.includes('kid')) {
                if (key.includes('pediatrics')) score += 10;
            }

            if (lowerQuery.includes('general') || lowerQuery.includes('practice') || lowerQuery.includes('primary')) {
                if (key.includes('general_practice')) score += 10;
            }

            if (lowerQuery.includes('insurance') || lowerQuery.includes('payment')) {
                if (key.includes('insurance')) score += 10;
            }

            if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent')) {
                if (key.includes('emergency')) score += 10;
            }

            if (lowerQuery.includes('prescription') || lowerQuery.includes('medication')) {
                if (key.includes('prescription')) score += 10;
            }

            if (lowerQuery.includes('hour') || lowerQuery.includes('time') || lowerQuery.includes('open')) {
                if (key.includes('clinic_hours')) score += 10;
            }

            if (lowerQuery.includes('new') || lowerQuery.includes('patient') || lowerQuery.includes('register')) {
                if (key.includes('new_patients')) score += 10;
            }

            if (lowerQuery.includes('telehealth') || lowerQuery.includes('video') || lowerQuery.includes('virtual')) {
                if (key.includes('telehealth')) score += 10;
            }

            // Add content-based scoring
            const contentLower = content.toLowerCase();
            if (contentLower.includes(lowerQuery)) {
                score += 5;
            }

            if (score > 0) {
                scoredResults.push({ key, score, content });
            }
        });

        // Sort by score and take top results
        scoredResults.sort((a, b) => b.score - a.score);

        const topResults = scoredResults.slice(0, nResults);

        if (topResults.length > 0) {
            logger.debug(`Local search found ${topResults.length} results for: "${query}"`);
            return topResults.map(result => result.content);
        }

        // Fallback responses if no specific matches
        return [
            'Our healthcare clinic provides General Practice, Cardiology, and Pediatrics services.',
            'We are open Monday through Friday from 9:00 AM to 5:00 PM.',
            'You can book appointments, get prescription refills, or speak with our AI assistant for medical guidance.'
        ].slice(0, nResults);
    }

    async addDocuments(documents: any[]): Promise<void> {
        if (this.limitedMode) {
            logger.info('📚 Adding documents to local knowledge base');

            documents.forEach(doc => {
                if (doc.id && doc.content) {
                    this.healthcareKnowledge.set(doc.id, doc.content);
                }
            });

            logger.debug(`Added ${documents.length} documents to local knowledge base`);
            return;
        }

        logger.warn('Cannot add documents - ChromaDB in limited mode');
    }

    async getCollectionInfo(): Promise<any> {
        return {
            mode: this.limitedMode ? 'local_knowledge_base' : 'chroma_db',
            documents_count: this.healthcareKnowledge.size,
            status: this.connected ? 'connected' : 'disconnected',
            limited_mode: this.limitedMode
        };
    }

    isConnected(): boolean {
        return this.connected;
    }

    isLimitedMode(): boolean {
        return this.limitedMode;
    }

    getKnowledgeBaseSize(): number {
        return this.healthcareKnowledge.size;
    }

    async destroy(): Promise<void> {
        logger.info('Chroma Service destroyed');
        this.healthcareKnowledge.clear();
    }

    async getStats(): Promise<{ vectorCount: number; responseTime: string; uptime: string; }> {
        // Implement or forward to Chromaserver API
        return { vectorCount: 0, responseTime: 'N/A', uptime: 'N/A' };
    }

    async healthCheck(): Promise<boolean> {
        // Implement health check logic
        return true;
    }
}
