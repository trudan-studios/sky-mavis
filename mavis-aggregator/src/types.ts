export type Event = {
    type: string,
    data: Record<string, any>,
}

export type TrackEventBody = {
    api_key: string;
    events: Event[],
}