import axios from "axios";
import { defineStore } from "pinia";
import { EventEmitter } from "events";
import { indexedDbService } from "@/services/indexDbServices";
import { Socket } from "@/services/socektServices";
import {
	type Message,
	type FileInfo,
	FileType,
	mapResponseToMessage,
} from "@/types/Message";
import type { Conversation } from "@/types/Conversation";
import type { TempFile } from "@/types/Commons";
import {
	type MessageStatusUpdate,
	MessageStatus,
	SyncMessageType,
} from "@/types/SocketEvents";
import { useUserStore } from "./user";
import { useSyncStore } from "./background_sync";
import { useAuthStore } from "./auth";
import { addMessageInState, updateMessageInState } from "@/utils/MessageUtils";
import { removeExtension } from "@/utils/StringUtils";

export const useMessageStore = defineStore("message", () => {
	const socket = new Socket("ws://localhost:8000/message/scoket/");
	socket.connect();

	const userStore = useUserStore();
	const syncStore = useSyncStore();
	const authStore = useAuthStore();

	class UploadEmitter extends EventEmitter {}
	const uploadEmitter = new UploadEmitter();

	//handle receiving message
	socket.on("message", async (msg) => {
		// Validate required field
		if (
			!msg.id ||
			!msg.conversation_id ||
			!msg.sender_id ||
			msg.message == null ||
			!msg.sending_time ||
			!msg.status
		) {
			console.log(
				!msg.id,
				!msg.conversation_id,
				!msg.sender_id,
				!msg.message,
				!msg.sending_time,
				!msg.status
			);
			console.error("Invalid message data:", msg);
			return;
		}

		const message = mapResponseToMessage(msg);

		// Store the message in IndexedDB
		await indexedDbService.addRecord("message", message);

		//check for conversation in indesedDb
		const conversation: Conversation = (await indexedDbService.getRecord(
			"conversation",
			message.conversationId
		)) as Conversation;

		//when the conversation is new
		if (!conversation) {
			const newConversation: Conversation = {
				id: message.conversationId,
				participant: message.senderId,
				startDate: null,
				lastMessageDate: message.sendingTime,
			};

			//TODO: a function to retrive all info about the conversation and update the indesed db

			userStore.conversations[message.conversationId as string] = {
				isActive: true,
				messages: [],
				lastMessageDate: message.sendingTime as string,
				participant: message.senderId as string,
			};

			await indexedDbService.addRecord("conversation", newConversation);
		} else {
			// Update the last conversation datetime
			userStore.conversations[message.conversationId!].lastMessageDate =
				message.sendingTime as string;

			conversation.lastMessageDate = message.sendingTime;
			await indexedDbService.updateRecord("conversation", conversation);
		}

		// Remove temp messagee(only for the sender)
		if (message.senderId == userStore.user.id) {
			if (msg.temp_id) {
				await indexedDbService.deleteRecord("message", msg.temp_id);
				// deleteMessageFromList(message.conversationId!, msg.temp_id);
				updateMessageInState(message, msg.temp_id);

				await indexedDbService.deleteRecord("tempFile", msg.temp_id);
			}
		} else {
			// Send acknowledgement to server that the message is being received
			const now = new Date().toISOString();
			const syncMessge: MessageStatusUpdate = {
				type: SyncMessageType.MessageStatus,
				data: [
					{
						message_id: message.id as string,
						timestamp: now,
					},
				],
				status: MessageStatus.received,
			};

			syncStore.sendMessage(syncMessge);
			addMessageInState(message);
		}
	});

	async function sendMessage(message: string) {
		if (!userStore.currentConversation) {
			return;
		}
		if (
			userStore.currentConversation.convId == null &&
			userStore.currentConversation.receiverId == null
		) {
			console.error("Both conversationId and receiverId are null");
			return;
		}

		const msg = {
			message: message,
			receiver_id: userStore.currentConversation.receiverId,
			conversation_id: userStore.currentConversation.convId,
			temp_id: crypto.randomUUID(),
		};

		// Make the data ready for indexedDb and add it
		const iDbMessage: Message = {
			id: msg.temp_id.toString(),
			senderId: userStore.user.id,
			receiverId: msg.receiver_id,
			conversationId: msg.conversation_id,
			message: msg.message,
			attachment: null,
			sendingTime: new Date().toISOString(),
			status: "pending",
			receivedTime: null,
			seenTime: null,
		};
		await indexedDbService.addRecord("message", iDbMessage);

		if (!userStore.currentConversation.convId) {
			//New conversation
			userStore.conversations[msg.temp_id] = {
				messages: [],
				isActive: true,
				participant: msg.receiver_id as string,
				lastMessageDate: new Date().toISOString(),
			};
			userStore.conversations[msg.temp_id].messages.push(iDbMessage);
		} else {
			// Old conversation
			userStore.conversations[
				userStore.currentConversation.convId
			]?.messages.push(iDbMessage);
		}

		socket.send(msg);
	}

	function deleteMessageFromList(
		convId: string,
		targetedId: string,
		candidateIndex = -1
	) {
		// Set candidateIndex to the last element on the first call
		if (candidateIndex === -1) {
			candidateIndex =
				userStore.conversations[convId].messages.length - 1;
		}

		// Base case: stop if candidateIndex is less than 0
		if (candidateIndex < 0) {
			return;
		}
		if (
			userStore.conversations[convId].messages[candidateIndex].id ==
			targetedId
		) {
			userStore.conversations[convId].messages.splice(candidateIndex, 1);
			return;
		}
		return deleteMessageFromList(convId, targetedId, candidateIndex - 1);
	}

	async function sendMessageWithFile(
		message: Message,
		file: File | null = null
	) {
		if (!message.conversationId && !message.receiverId) {
			console.error("either receiverId or conversationId is required");
			return;
		}

		try {
			// If no file is given try to get the file from indexedDB else add the file to the database
			if (!file) {
				const fileRequest = (await indexedDbService.getRecord(
					"tempFile",
					message.id
				)) as TempFile | null;

				if (!fileRequest) {
					console.error("Couldnot get the file");
					return;
				}

				file = fileRequest.file;
			} else {
				const tempFile: TempFile = {
					id: message.id,
					file: file,
				};
				await indexedDbService.addRecord("tempFile", tempFile);
			}

			if (!message.attachment) {
				message.attachment = {
					type: FileType.attachment,
					name: file.name,
					key: null,
					tempFileId: null,
					size: file.size,
				};
			}

			if (!(await indexedDbService.getRecord("message", message.id))) {
				await indexedDbService.addRecord("message", message);
				console.log("adding message in state");
				addMessageInState(message);
			}

			uploadEmitter.emit("uploadPreprocessing", message.id);
			const response = await authStore.authAxios({
				method: "get",
				url: "messages/upload-url",
			});
			console.log(response);

			if (response.status === 200) {
				response.data.fields["file"] = file;

				const uploadResponse = await axios({
					method: "post",
					headers: {
						"Content-Type": "multipart/form-data",
					},
					url: response.data.url,
					data: response.data.fields,
					onUploadProgress(progressEvent) {
						const percentCompleted = Math.round(
							(progressEvent.loaded * 100) /
								(progressEvent.total ?? file!.size)
						);
						uploadEmitter.emit(
							"uploadProgress",
							message.id,
							percentCompleted
						);
						console.log(progressEvent.loaded);
						console.log(percentCompleted);
					},
				});

				console.log("status code : ", uploadResponse.status);

				if (uploadResponse.status === 204) {
					uploadEmitter.emit("uploadPostProcessing", message.id);
					const fileData = {
						temp_file_id: response.data.fields.key,
						name: file.name,
					};

					const msg = {
						message: message.message,
						receiver_id: message.receiverId,
						conversation_id: message.conversationId,
						temp_id: message.id,
						attachment: fileData,
					};

					const messageResponse = await authStore.authAxios({
						method: "post",
						url: "messages/media-message",
						data: msg,
					});

					console.log(messageResponse);
				}
			}
		} catch (error) {
			uploadEmitter.emit("uploadError", message.id);
			console.error(error);
		}
	}

	async function downloadFile(file: FileInfo) {
		try {
			const response = await authStore.authAxios({
				method: "get",
				url: `messages/download-url?key=${file.key}`,
			});

			if (response.status === 200) {
				const fetchResponse = await fetch(response.data);

				// Ensure the fetch is successfull
				if (!fetchResponse.ok) {
					throw new Error(
						`Failed to fetch file: ${fetchResponse.statusText}`
					);
				}

				//Create the url
				const imageBlog = await fetchResponse.blob();
				const imageURL = URL.createObjectURL(imageBlog);

				// Create a temporary anchor element to trigger the download
				const link = document.createElement("a");
				link.href = imageURL;
				link.download = removeExtension(file.name as string);

				// Add the anchor tag, trigger the download and remove it,
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			}
		} catch (error) {
			console.error("Error downloading file:", error);
		}
	}

	return { uploadEmitter, sendMessage, sendMessageWithFile, downloadFile };
});
