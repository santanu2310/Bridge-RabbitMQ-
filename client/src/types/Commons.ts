export type PacketType =
	| "open"
	| "close"
	| "ping"
	| "pong"
	| "message"
	| "upgrade"
	| "noop"
	| "error";

export type RawData = any;

export interface Packet {
	type: PacketType;
	data?: RawData;
}

export interface UserBrief {
	id: string;
	username: string;
	full_name: string;
	bio: string | null;
	profile_picture: string | null;
}

export interface FriendRequest {
	type: string;
	id: string;
	user: UserBrief;
	message: string | null;
	status: string;
	created_time: string;
}

export enum FileStatus {
	preProcessing = "preProcessing",
	uploading = "uploading",
	postProcessing = "postProcessing",
	successfull = "successfull",
	unsucessfull = "unsucessfull",
}

export interface TempFile {
	id: string;
	file: File;
}

export interface profileMedia {
	id: string;
	avatar: Blob | null;
	banner: Blob | null;
}

export interface profileMediaUrls {
	avatar: string | null;
	banner: string | null;
}

export interface callState {
	callId: string;
	participants: string[];
	isMuted: boolean;
	isCameraOn: boolean;
	callStatus: "calling" | "ringing" | "in_call";
	minimised: boolean;
}
