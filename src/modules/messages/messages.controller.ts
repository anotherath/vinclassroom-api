import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CreateMessageDto,
  UpdateMessageDto,
  AddReactionDto,
  QueryMessagesDto,
} from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * POST /rooms/:roomId/messages
   * Send a message to a room
   */
  @Post('rooms/:roomId/messages')
  @HttpCode(HttpStatus.CREATED)
  async createMessage(
    @Param('roomId') roomId: string,
    @Body() dto: CreateMessageDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const message = await this.messagesService.createMessage(
      roomId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: message,
    };
  }

  /**
   * GET /rooms/:roomId/messages
   * Get messages in a room
   */
  @Get('rooms/:roomId/messages')
  @HttpCode(HttpStatus.OK)
  async getRoomMessages(
    @Param('roomId') roomId: string,
    @Query() query: QueryMessagesDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.messagesService.getRoomMessages(
      roomId,
      req.user.id,
      query,
    );
    return {
      success: true,
      data: result.messages,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * GET /messages/:messageId
   * Get a specific message
   */
  @Get('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async getMessage(@Param('messageId') messageId: string): Promise<any> {
    const message = await this.messagesService.getMessageWithDetails(messageId);
    return {
      success: true,
      data: message,
    };
  }

  /**
   * PATCH /messages/:messageId
   * Update a message
   */
  @Patch('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async updateMessage(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const message = await this.messagesService.updateMessage(
      messageId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: message,
    };
  }

  /**
   * DELETE /messages/:messageId
   * Delete a message (soft delete)
   */
  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(
    @Param('messageId') messageId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.messagesService.deleteMessage(messageId, req.user.id);
    return {
      success: true,
      message: 'Message deleted successfully',
    };
  }

  /**
   * GET /messages/:messageId/thread
   * Get thread replies
   */
  @Get('messages/:messageId/thread')
  @HttpCode(HttpStatus.OK)
  async getThreadReplies(
    @Param('messageId') messageId: string,
    @Query() query: QueryMessagesDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.messagesService.getThreadReplies(
      messageId,
      req.user.id,
      query,
    );
    return {
      success: true,
      data: result.messages,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * POST /messages/:messageId/pin
   * Pin a message
   */
  @Post('messages/:messageId/pin')
  @HttpCode(HttpStatus.OK)
  async pinMessage(
    @Param('messageId') messageId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.messagesService.pinMessage(messageId, req.user.id);
    return {
      success: true,
      message: 'Message pinned successfully',
    };
  }

  /**
   * DELETE /messages/:messageId/pin
   * Unpin a message
   */
  @Delete('messages/:messageId/pin')
  @HttpCode(HttpStatus.OK)
  async unpinMessage(
    @Param('messageId') messageId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.messagesService.unpinMessage(messageId, req.user.id);
    return {
      success: true,
      message: 'Message unpinned successfully',
    };
  }

  /**
   * GET /rooms/:roomId/pins
   * Get pinned messages in a room
   */
  @Get('rooms/:roomId/pins')
  @HttpCode(HttpStatus.OK)
  async getPinnedMessages(
    @Param('roomId') roomId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const messages = await this.messagesService.getPinnedMessages(
      roomId,
      req.user.id,
    );
    return {
      success: true,
      data: messages,
    };
  }

  /**
   * POST /messages/:messageId/reactions
   * Add reaction to a message
   */
  @Post('messages/:messageId/reactions')
  @HttpCode(HttpStatus.CREATED)
  async addReaction(
    @Param('messageId') messageId: string,
    @Body() dto: AddReactionDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const reaction = await this.messagesService.addReaction(
      messageId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: reaction,
    };
  }

  /**
   * DELETE /messages/:messageId/reactions/:emoji
   * Remove reaction from a message
   */
  @Delete('messages/:messageId/reactions/:emoji')
  @HttpCode(HttpStatus.OK)
  async removeReaction(
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.messagesService.removeReaction(messageId, req.user.id, emoji);
    return {
      success: true,
      message: 'Reaction removed successfully',
    };
  }
}
