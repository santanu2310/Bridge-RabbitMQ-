<script setup lang="ts">
	interface Props {
		size?: number;
	}
	const { size = 60 } = defineProps<Props>();
</script>

<template>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="currentColor"
		:width="`${size}%`"
		:height="`${size}%`"
	>
		<path
			d="M20 17H22V19H2V17H4V10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10V17ZM9 21H15V23H9V21Z"
		></path>
	</svg>
</template>
