import { UseQueryResult, keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { getComments, postRecommendReply } from "../apis/comment";

import { useEffect } from "react";

export const useGetComments = (
  id: string | undefined,
  type: "positive" | "negative",
): UseQueryResult<CommentType[], Error> => {
  return useQuery<CommentType[], Error>({
    queryKey: ["comments", id, type],
    queryFn: () => getComments(id as string, type),
    enabled: !!id,
    staleTime: 60 * 1000, // 1분간 데이터 유지
    retry: false,
  });
};

// 댓글과 추천 답글을 함께 가져오는 React Query 훅
export const useGetCommentsWithAsyncReplies = (
  id: string | undefined,
  type: "positive" | "negative",
  limit: number = 3,
): UseQueryResult<CommentWithReplyType[], Error> => {
  const queryClient = useQueryClient();

  // 일반 댓글 가져오기
  const queryResult = useQuery<CommentWithReplyType[], Error>({
    queryKey: ["comments", id, type],
    queryFn: () => getComments(id as string, type),
    enabled: !!id,
    staleTime: 60 * 1000, // 1분간 데이터 유지
    retry: false,
    placeholderData: keepPreviousData, // 이전 데이터를 유지하면서 백그라운드에서 새로운 데이터를 가져오기
  });

  useEffect(() => {
    // 댓글이 존재하고 추천 답글이 없는 경우에만 추천 답글 요청을 수행
    if (queryResult.data) {
      // 댓글 중에 추천 답글이 아직 없는 것이 있는지 확인
      const hasNoReplies = queryResult.data.some(
        (comment) => !comment.recommendedReplies || comment.recommendedReplies.length === 0,
      );

      // 추천 답글이 없는 경우에만 비동기로 가져오기
      if (hasNoReplies) {
        const fetchReplies = async () => {
          const comments = queryResult.data ?? [];

          // 각 댓글에 대해 추천 답글을 비동기로 병렬 처리
          const updatedComments = await Promise.allSettled(
            comments.map(async (comment) => {
              // 이미 추천 답글이 있으면 건너뜀
              if (comment.recommendedReplies && comment.recommendedReplies.length > 0) {
                return comment;
              }

              try {
                // 추천 답글을 요청할 때 limit 전달
                const recommendedRepliesResponse = await postRecommendReply(comment, limit);

                // 추천 답글의 `reply` 값들을 추출해서 recommendedReplies에 저장
                const replies = recommendedRepliesResponse.map((replyObj) => replyObj.reply);
                return { ...comment, recommendedReplies: replies };
              } catch {
                return comment; // 추천 답글 요청 실패 시 기존 댓글 유지
              }
            }),
          );

          // 성공한 결과들을 반영하여 상태 업데이트
          const finalComments = updatedComments.map((result, index) => {
            if (result.status === "fulfilled") {
              return result.value;
            } else {
              return comments[index];
            }
          });

          // 쿼리 캐시 업데이트 (추천 답글이 추가된 경우에만)
          queryClient.setQueryData(["comments", id, type], finalComments);
        };

        fetchReplies();
      }
    }
  }, [queryResult.data, queryClient, id, type, limit]);

  return queryResult;
};
