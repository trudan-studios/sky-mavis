import {v4 as uuidv4} from 'uuid';
import UAParser from "ua-parser-js";

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
type MavisEventType = 'identify' | 'screen' | 'track';

interface EventBase {
    type?: MavisEventType;
    data: {
        uuid: string;
        ref: string;
        timestamp: string;
        session_id: string;
        offset: number;
        user_id?: string;
        type?: string;
        [key: string]: any;
    }
}

interface PlatformProperties {
    build_version?: string;
    device_name?: string;
    device_id?: string;
    platform_name: string;
    platform_version?: string;
    internet_type?: string;
}

export interface IdentifyEvent extends EventBase {
    data: EventBase["data"] & PlatformProperties & {
        ronin_address: string;
        user_properties?: {
            [key: string]: any;
        };
        [key: string]: any;
    }
    type: 'identify';
}

export interface ScreenEvent extends EventBase {
    data: EventBase["data"] & {
        screen: string;
        screen_properties?: Record<string, any>;
        [key: string]: any;
    }
    type: 'screen';
}

export interface TrackEvent extends EventBase {
    data: EventBase["data"] & {
        action: string;
        action_properties?: Record<string, any>;
        [key: string]: any;
    }
    type: 'track';
}

type Event = IdentifyEvent | ScreenEvent | TrackEvent;
type MavisTrackingOptions = {
    apiUrl?: string;
    flushInterval?: number;
    enableHeartbeat?: boolean;
    heartbeatInterval?: number;
};

export class MavisTracking {
    private apiKey: string;
    private apiUrl: string;
    private sessionId: string;
    private lastRef: string;
    private offset: number;
    private queue: Event[];
    private flushInterval: number;
    private flushTimeout: ReturnType<typeof setTimeout> | null;
    private heartbeatInterval: number;
    private heartbeatIntervalId: ReturnType<typeof setInterval> | null;
    private userId: string | null;
    private roninAddress: string;
    private readonly agentData: UAParser.IResult = new UAParser().getResult();

    constructor(apiKey: string, options: MavisTrackingOptions = {}) {
        this.apiKey = apiKey;
        this.apiUrl = options.apiUrl || 'https://x.skymavis.com/track';
        this.sessionId = uuidv4();
        this.lastRef = 'root';
        this.offset = 0;
        this.queue = [];
        this.flushInterval = options.flushInterval || 10000; // 10 seconds default
        this.flushTimeout = null;
        this.heartbeatInterval = options.heartbeatInterval || 30000; // 30 seconds default
        this.heartbeatIntervalId = null;
        this.userId = null;
        this.roninAddress = ADDRESS_ZERO;

        if (options.enableHeartbeat !== false) // Default to true
        {
            this.startHeartbeat();
        }
    }

    private createBaseEvent(): EventBase {
        const event: EventBase = {
            data: {
                uuid: uuidv4(),
                ref: this.lastRef,
                timestamp: new Date().toISOString(),
                session_id: this.sessionId,
                offset: this.offset++,
                user_id: this.userId || undefined
            }
        };
        this.lastRef = event.data.uuid;
        return event;
    }

    private queueEvent(event: Event): void {
        this.queue.push(event);
        this.scheduleFlush();
    }

    private heartbeat(): void {
        const heartbeatEvent: TrackEvent = {
            ...this.createBaseEvent(),
            type: 'track',
            data: {
                ...this.createBaseEvent().data,
                action: 'heartbeat'
            }
        };
        this.sendEvent(heartbeatEvent);
    }

    private startHeartbeat(): void {
        this.heartbeat(); // Send initial heartbeat
        this.heartbeatIntervalId = setInterval(() => this.heartbeat(), this.heartbeatInterval);
    }

    private scheduleFlush(): void {
        if (this.flushTimeout === null) {
            this.flushTimeout = setTimeout(() => this.flush(), this.flushInterval);
        }
    }

    private async postEvents(events: Event[]): Promise<void> {
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Authorization': `Basic ${btoa(this.apiKey + ':')}`
        });

        const body = JSON.stringify({
            api_key: this.apiKey,
            events: events
        });

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
    }

    /**
     * Send an event to the tracking server. This method is intended for internal use only.
     * For example to send heartbeats or to force send an event (rare case).
     * @param event
     * @private
     */
    private async sendEvent(event: Event): Promise<void> {
        try {
            await this.postEvents([event]);
        } catch (error) {
            console.error('Failed to send event:', error);
            // We're not re-queuing the event here because it's not a common case.
        }
    }

    private async flush(): Promise<void> {
        if (this.queue.length === 0) return;
        const events = [...this.queue];
        this.queue = [];
        this.flushTimeout = null;

        try {
            await this.postEvents(events);
        } catch (error) {
            console.error('Failed to send events:', error);
            // Re-queue failed events
            this.queue = [...events, ...this.queue];
        }
    }

    identify(userId: string,
             roninAddress: string,
             userProperties: IdentifyEvent["data"]["user_properties"],
    ): void {
        this.userId = userId;
        this.roninAddress = roninAddress || ADDRESS_ZERO;

        const event: IdentifyEvent = {
            type: 'identify',
            data: {
                ...this.createBaseEvent().data,
                ...this.getPlatformData(),
                ronin_address: this.roninAddress,
                user_properties: userProperties
            }
        };
        this.queueEvent(event);
    }

    screen(screenName: string, screenProperties?: ScreenEvent["data"]["screen_properties"]): void {
        const event: ScreenEvent = {
            ...this.createBaseEvent(),
            type: 'screen',
            data: {
                ...this.createBaseEvent().data,
                screen: screenName,
                screen_properties: screenProperties
            }
        };
        this.queueEvent(event);
    }

    track(action: string, actionProperties?: TrackEvent["data"]["action_properties"]): void {
        const event: TrackEvent = {
            ...this.createBaseEvent(),
            type: 'track',
            data: {
                ...this.createBaseEvent().data,
                action: action,
                action_properties: actionProperties
            }
        };
        this.queueEvent(event);
    }

    resetSession(): void {
        this.sessionId = uuidv4();
        this.lastRef = 'root';
        this.offset = 0;
        this.userId = null;
        this.roninAddress = ADDRESS_ZERO;
    }

    async shutdown(): Promise<void> {
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
        }
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
        }
        await this.flush();
    }

    private getPlatformData(): PlatformProperties {
        return {
            platform_name: this.agentData.os.name ?? 'Unknown',
            platform_version: this.agentData.os.version,
            device_name: this.agentData.device.model,
            device_id: this.agentData.device.type!,
            build_version: this.agentData.browser.version,
        };
    }
}

export default MavisTracking;