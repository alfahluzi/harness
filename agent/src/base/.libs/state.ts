import { MessagesValue, StateSchema } from "@langchain/langgraph";

export const GraphAnnotation = new StateSchema({
	messages: MessagesValue,
});
